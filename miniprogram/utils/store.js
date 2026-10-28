const { t: uiText } = require('./ui-preferences');
// 全局状态仓库：持有 Gateway 连接、工作区/会话列表、当前会话投影与待处理

const { GatewayClient } = require('./gateway');
const protocol = require('./protocol');
const { recentWindow } = require('./history-window');
const { createLocalCache, utf8ByteLength } = require('./local-cache');
const sessionViewCache = require('./session-view-cache');
const collaboration = require('./collaboration');
const pairing = require('./pairing');
const hosts = require('./hosts');
const schedule = require('./schedule');
const turnUsage = require('./turn-usage');
const pluginsLib = require('./plugins');
const { createInstaller } = require('./plugin-install');
const util = require('./util');
const accessApi = require('./access-api');
const { normalizeHostInfo } = require('./host-info');
const routeTable = require('./route-table');
const runtime = require('./runtime');

const STORAGE_KEYS = {
  endpoint: 'dsh_endpoint', // 仅用于旧版单主机凭据迁移
  token: 'dsh_token',       // 仅用于旧版单主机凭据迁移
  trustedEndpoints: 'dsh_trusted_endpoints',
  defaults: 'dsh_defaults'
};

const PENDING_KIND = {
  question: 'question',
  approval: 'approval'
};

function createStore() {
  const listeners = [];
  // 上下文面板是否处于可见分段（页面切入「上下文」时置 true）：
  let contextActive = false;
  // 编队面板同理：独立可见性，避免每次事件都传整份家族快照。
  let fleetActive = false;
  // v2 动态刷新：上下文/编队面板可见且会话运行中时每 2.5s 拉一次快照。
  const CONTEXT_POLL_MS = 2500;
  const CONTEXT_REQUEST_TIMEOUT_MS = 8000;
  let contextPollTimer = null;
  let fleetPollTimer = null;
  let contextRequestPending = false;
  let fleetRequestPending = false;
  let contextRequestTimer = null;
  let fleetRequestTimer = null;
  function createContextDashboardState() {
    return { loading: false, error: null, code: '', unsupported: false, asOfSeq: null, value: null };
  }
  function createContextFleetState() {
    return { loading: false, error: null, code: '', unsupported: false, asOfSeq: null, value: null };
  }
  const state = {
    connection: 'disconnected', // disconnected | connecting | connected | failed
    everConnected: false,        // 曾连上过：断链（红）与从没连上（灰/橙）的区分依据
    connectionMessage: null,
    connectionErrorCode: null,
    paired: false,
    gatewayName: null,
    gatewayMetadata: null,
    gatewayCapabilities: [],
    gatewayId: null,
    endpoint: null,
    port: null,
    clientCount: null,

    // 多主机（MultiGatewayStore 对齐）
    profiles: [],
    activeID: null,
    onlineIDs: [],

    workspaces: [],
    archivedSessionIds: [],
    currentWorkspaceId: null,
    isUngroupedWorkspaceSelected: false,
    sessions: [],
    searchResults: null,
    searchQuery: '',

    host: null,
    defaults: null,
    defaultModel: null,
    agentPresets: null,
    modelCatalog: null,
    coreCompatibilityError: '',

    // 自动化任务（对齐 iOS AppStore scheduledTasks*）
    scheduledTasks: [],
    scheduledTasksLoading: false,
    scheduledTasksError: null,
    scheduledTaskPendingId: null,     // 正在变更的任务 id（按钮禁用）
    scheduleCompletedRequestId: null, // 最近一次成功变更的 requestId（编辑页据此关闭）
    scheduleMutationError: null,

    // 插件管理（对齐 iOS AppStore pluginCatalog*）
    pluginCatalog: null,
    pluginsLoading: false,
    pluginsError: null,
    pluginPendingName: null,
    pluginNotice: null,
    pluginInstall: null,

    notice: null
  };

  // 当前会话工作区（仅会话页读写）
  const sessionState = {
    sessionId: null,
    rowsAgg: null,
    rows: [],
    trajectory: [],
    collaboration: collaboration.create(null),
    running: false,
    historyFormatVersion: null,
    hasMoreHistory: false,
    historyPaging: false,
    historyLastPageBytes: 0,
    nextBeforeSeq: null,
    title: '',
    agentPreset: null,
    pendingQuestion: null,
    pendingApproval: null,
    questionStatus: 'idle',
    approvalStatus: 'idle',
    stats: null,
    // 上下文面板（context-dashboard 帧）：保留最近一次值，刷新期间可继续展示旧数据
    contextDashboard: createContextDashboardState(),
    // 编队面板（context-fleet 帧）：与上下文面板独立，互不影响
    contextFleet: createContextFleetState(),
    queue: [],
    tasks: null,
    tasksAsOfSeq: null,
    goal: null,
    goalAsOfSeq: null,
    goalMutation: '',
    commandGroups: [],
    commandOptions: [],
    commandOptionsFor: '',
    commandLoading: false,
    commandError: '',
    historyError: '',
    historyState: 'idle',   // idle | requested | loaded:N | error:msg | sub-failed
    ingestErrors: 0,
    lastFrames: [],         // 最近 8 个帧 kind（诊断用）
    permission: null,
    permissionOptions: null,
    selection: null,
    runStartMs: null,       // 运行指示条起始时间（最近一条用户消息时间）
    agentPresetAsOfSeq: null,
    agentPresetAuthoritative: false,
    runCues: []             // 运行活动线索（供运行指示条短语轮换）
  };

  const client = new GatewayClient({
    onState: function (status, message, errorCode, deliberate) {
      state.connection = status;
      state.connectionMessage = message;
      state.connectionErrorCode = errorCode || null;
      // Candidate fallback changes GatewayClient.endpoint before notifying us.
      // Keep the store endpoint in sync so pairing credentials and the preferred
      // route are saved against the route that actually completed the handshake.
      if ((status === 'connecting' || status === 'connected') && client.endpoint) {
        state.endpoint = client.endpoint;
      }
      // 断链展示：只有用户主动断开才清掉「曾连上」标记，意外掉线保留 → 红色。
      if (status === 'connected') state.everConnected = true;
      else if (deliberate === true) state.everConnected = false;
      pluginInstaller.connectionChanged(status);
      syncHealthCheck();
      if (status !== 'connected') {
        state.gatewayMetadata = null;
        state.gatewayCapabilities = [];
        clearSessionDetailsBootstrap();
        clearSessionStatsBootstrap();
        clearStatsRetry();
        // 断链后快照不会再来：停自动刷新并释放 in-flight 标记，重连后重新拉取。
        stopContextPolling();
      }
      if (status === 'connected') {
        resetHistoryPaging();
        // 记住这次真正连通的地址，下次优先使用；轮换游标对齐当前线路
        endpointCandidates = endpointCandidates.length ? endpointCandidates : [state.endpoint];
        // 候选被兜底成单条时按地址特征补线路族，保证轮换/中继升级判断有据可依。
        if (endpointCandidateMeta.length !== endpointCandidates.length) {
          endpointCandidateMeta = endpointCandidates.map(candidate => ({
            endpoint: candidate,
            kind: routeTable.classifyEndpoint(candidate) || 'lan'
          }));
        }
        endpointIdx = Math.max(0, endpointCandidates.indexOf(state.endpoint));
        if (rotationTimer) { clearTimeout(rotationTimer); rotationTimer = null; }
        if (state.activeID) {
          const profile = getProfile(state.activeID);
          if (profile) {
            let profileChanged = false;
            if (profile.preferredEndpoint !== state.endpoint && endpointCandidates.indexOf(state.endpoint) >= 0) {
              profile.preferredEndpoint = state.endpoint;
              profileChanged = true;
            }
            // 经中继连上（v2 直连二维码的中继候选）：把档案升级成中继档案，
            // 否则下次重连不会带 E2EE 元信息，又掉回直连候选。gatewayId 换成
            // 中继 nodeId（与 v3 载荷一致）：重连的中继参数和 E2EE 验签都用它。
            if (client.routeKind === 'relay' && !profile.relay && client.relayMeta && client.relayMeta.agentPubKey) {
              profile.relay = true;
              profile.relayAgentPubKey = client.relayMeta.agentPubKey;
              profile.relayAuthMode = client.relayMeta.authMode || 'invite';
              profile.relayRole = profile.relayRole || 'guest';
              if (client.relayMeta.nodeId) profile.gatewayId = client.relayMeta.nodeId;
              profileChanged = true;
            }
            if (profileChanged) hosts.saveProfiles(state.profiles);
          }
        }
        state.workspaceRetries = 0;
        state.sessionsRetries = 0;
        // 切换主机/重连会先清空业务状态；网络请求返回前先恢复该主机
        restoreHomeCacheAfterCoreFailure('workspaces');
        restoreHomeCacheAfterCoreFailure('sessions');
        bootstrap();
        if (contextActive) refreshContextDashboard(true);
        if (fleetActive) refreshContextFleet(true);
        syncContextPolling();
        syncFleetPolling();
        startDataWatchdog();
      } else if (status === 'failed') {
        if (pendingPairing) {
          pendingPairing = false;
          pendingProfile = null;
          emit();
          return;
        }
        // 候选地址循环轮换（中继 ↔ 直连互为备份，3s 节流防紧密循环）：
        if (status === 'failed' && endpointCandidates.length > 1) {
          endpointIdx = (endpointIdx + 1) % endpointCandidates.length;
          const profile = getProfile(state.activeID);
          const next = endpointCandidates[endpointIdx];
          const nextMeta = endpointCandidateMeta[endpointIdx] || { endpoint: next, kind: 'lan' };
          if (profile && next) {
            state.endpoint = next;
            state.connectionMessage = uiText('切换线路重连中…');
            state.connectionErrorCode = null;
            // 连接参数按候选线路族构建：中继候选带 E2EE 元信息，直连候选用网关 token。
            const connectOpts = connectOptionsFor(profile, nextMeta, hosts.loadCredential(profile.id));
            if (connectOpts) {
              if (connectOpts.relay) client.lastToken = null;
              if (rotationTimer) clearTimeout(rotationTimer);
              rotationTimer = setTimeout(function () {
                rotationTimer = null;
                if (client.wantsConnection && state.endpoint === next) {
                  client.connect(next, Object.assign({}, connectOpts, { routeKind: nextMeta.kind }));
                }
              }, 3000);
            }
            emit();
            return;
          }
        }
      } else if (status === 'disconnected') {
        state.paired = false;
      }
      emit();
    },
    onPaired: function (frame) {
      pendingPairing = false;
      state.paired = true;
      acceptIdentity(frame);
    },
    onRelayAuthorized: function (frame, relayMeta) {
      const profile = relayMeta
        ? state.profiles.find((item) => item.gatewayId === relayMeta.nodeId)
        : getProfile(state.activeID) || pendingProfile;
      if (profile) {
        profile.relayAccessToken = frame.accessToken || null;
        profile.relayRole = frame.role === 'owner' ? 'owner' : 'guest';
        // Gateway grants belong to the device registry, not relay invite frames.
        if (profile.relayAuthMode !== 'gateway') profile.relayExpiresAt = Number(frame.expiresAt || 0) || null;
        profile.relayClientCount = Number(frame.clientCount || 0);
        upsertProfile(profile);
        emit();
      }
    },
    onRelayClientCount: function (count, relayMeta) {
      const profile = relayMeta
        ? state.profiles.find((item) => item.gatewayId === relayMeta.nodeId)
        : getProfile(state.activeID);
      if (profile && profile.relay) {
        profile.relayClientCount = count;
        emit();
      }
    },
    onFrame: function (frame) {
      handleFrame(frame);
    },
    onNotice: function (text, isError) {
      state.notice = { text: text, isError: !!isError, at: Date.now() };
      emit();
    }
  });

  const pluginInstaller = createInstaller({ state, client, emit, refresh: refreshPlugins });

  function emit() {
    const snapshot = { app: state, session: sessionState };
    listeners.forEach(function (listener) {
      try { listener(snapshot); } catch (e) { /* 页面已卸载等 */ }
    });
  }

  /** 数据看门狗：握手成功但数据帧静默（fnOS 半死）→ 主动断链，交给端点轮换重连 */
  function startDataWatchdog() {
    if (dataWatchdogTimer) clearTimeout(dataWatchdogTimer);
    dataWatchdogTimer = setTimeout(function () {
      dataWatchdogTimer = null;
      if (state.connection !== 'connected') return;
      if (state.workspaces.length || state.sessions.length) return;
      if (typeof client.handleTransportFailure === 'function') {
        client.handleTransportFailure(uiText('数据通道无响应，正在重新连接'));
      }
    }, 12000);
  }

  // Shared bounded L1/L2 history cache. Host scope is part of every key;
  // credentials never enter this cache.
  const sessionCache = createLocalCache({ prefix: 'dsh_session_cache', version: 2,
    maxEntries: 20, maxBytes: 600000, storage: typeof wx !== 'undefined' ? wx : null, setTimeout, clearTimeout });
  // Already-visited immutable history pages let the turn navigator move through
  // older turns locally instead of re-reading the same page from the gateway.
  const historyPageCache = createLocalCache({ prefix: 'dsh_history_page', version: 1,
    maxEntries: 16, maxBytes: 420000, storage: typeof wx !== 'undefined' ? wx : null, setTimeout, clearTimeout });
  let sessionCacheScope = null;
  // Keep the compact, complete outline separate from the bounded message tail.
  const turnOutlineCache = createLocalCache({ prefix: 'dsh_turn_outline', version: 1,
    maxEntries: 20, maxBytes: 4 * 1024 * 1024, storage: typeof wx !== 'undefined' ? wx : null, setTimeout, clearTimeout });
  // 上下文/编队面板：会话内即时复用上次结果，避免二次进入重新等待网关回放
  // v2: mobileContext stateVersion 5 stamps per-request activeMs (the trend
  // chart's duration curve); v1 entries predate the field and would render a
  // curve-less chart until the next refresh.
  const CONTEXT_PANEL_CACHE_VERSION = 2;
  const contextPanelCache = createLocalCache({ prefix: 'dsh_context_cache', version: 1,
    maxEntries: 20, maxBytes: 400000, storage: typeof wx !== 'undefined' ? wx : null, setTimeout, clearTimeout });
  const homeCache = createLocalCache({ prefix: 'dsh_home_cache', version: 1,
    maxEntries: 20, maxBytes: 400000, storage: typeof wx !== 'undefined' ? wx : null, setTimeout, clearTimeout });

  function activeCacheScope() {
    return String(state.activeID || state.endpoint || '');
  }

  function contextPanelCacheKey(sessionId) {
    const scope = activeCacheScope();
    return (scope ? encodeURIComponent(scope) + ':' : '') + String(sessionId || '') + '@v' + CONTEXT_PANEL_CACHE_VERSION;
  }

  function rememberContextPanels(sessionId) {
    if (!sessionId) return;
    const dashboard = sessionState.contextDashboard;
    const fleet = sessionState.contextFleet;
    if (!dashboard || dashboard.loading) return;
    const entry = { dashboard, fleet, savedAt: Date.now() };
    // 磁盘写入去抖：运行中 2.5s 刷新一次，避免每帧同步写全量快照。
    contextPanelCache.set(contextPanelCacheKey(sessionId), entry, { delayMs: 1500 });
  }

  function restoreContextPanels(sessionId) {
    const cached = contextPanelCache.get(contextPanelCacheKey(sessionId), value => value && value.dashboard ? value : null);
    return cached ? { dashboard: cached.dashboard, fleet: cached.fleet || null } : { dashboard: null, fleet: null };
  }

  let sessionBootstrapTimer = null;
  let coreBootstrapTimer = null;
  let sessionDetailsBootstrapTimer = null;
  let sessionDetailsBootstrap = null;
  let sessionStatsBootstrapTimer = null;
  let sessionStatsBootstrap = null;
  function scheduleCoreBootstrap(callback, delay) {
    if (coreBootstrapTimer) clearTimeout(coreBootstrapTimer);
    coreBootstrapTimer = setTimeout(function () {
      coreBootstrapTimer = null;
      callback();
    }, delay == null ? 400 : delay);
  }

  function clearSessionStatsBootstrap() {
    if (sessionStatsBootstrapTimer) clearTimeout(sessionStatsBootstrapTimer);
    sessionStatsBootstrapTimer = null;
    sessionStatsBootstrap = null;
  }

  function clearSessionDetailsBootstrap() {
    if (sessionDetailsBootstrapTimer) clearTimeout(sessionDetailsBootstrapTimer);
    sessionDetailsBootstrapTimer = null;
    sessionDetailsBootstrap = null;
  }

  // Keep optional composer/session RPCs off the wire until the first history tail
  // arrives. Their work is useful, but it must not delay the visible conversation.
  function scheduleSessionDetailsBootstrap(sessionId, delay, expedite, refreshSessionList) {
    if (!sessionId || state.connection !== 'connected') return;
    const generation = client.connectGeneration;
    const sameRequest = sessionDetailsBootstrap && sessionDetailsBootstrap.sessionId === sessionId &&
      sessionDetailsBootstrap.generation === generation;
    if (sameRequest && sessionDetailsBootstrap.started) {
      if (refreshSessionList && !sessionDetailsBootstrap.refreshSessionList) {
        sessionDetailsBootstrap.refreshSessionList = true;
        safeRequest(client.requestSessions(), uiText('会话列表'), 'sessions');
      }
      return;
    }
    if (sameRequest && sessionDetailsBootstrapTimer && !expedite) {
      sessionDetailsBootstrap.refreshSessionList = sessionDetailsBootstrap.refreshSessionList || refreshSessionList === true;
      return;
    }
    const refreshList = refreshSessionList === true || sameRequest && sessionDetailsBootstrap.refreshSessionList;
    clearSessionDetailsBootstrap();
    const pending = { sessionId, generation, started: false, refreshSessionList: refreshList };
    sessionDetailsBootstrap = pending;
    sessionDetailsBootstrapTimer = setTimeout(function () {
      sessionDetailsBootstrapTimer = null;
      if (sessionDetailsBootstrap !== pending || state.connection !== 'connected' ||
          sessionState.sessionId !== sessionId || client.connectGeneration !== generation) return;
      pending.started = true;
      safeRequest(client.requestPermissionOptions(sessionId));
      safeRequest(client.requestModels(sessionId));
      safeRequest(client.requestCommands(sessionId));
      safeRequest(client.requestTasks(sessionId));
      safeRequest(client.requestGoal(sessionId));
      if (pending.refreshSessionList) safeRequest(client.requestSessions(), uiText('会话列表'), 'sessions');
    }, delay == null ? 2500 : delay);
  }

  // These projections scan the host's event log. Keep them behind the visible
  // history tail; otherwise they compete with the first conversation response.
  function scheduleSessionStatsBootstrap(sessionId, delay, expedite) {
    if (!sessionId || state.connection !== 'connected') return;
    const generation = client.connectGeneration;
    const sameRequest = sessionStatsBootstrap && sessionStatsBootstrap.sessionId === sessionId &&
      sessionStatsBootstrap.generation === generation;
    if (sameRequest && sessionStatsBootstrap.started) return;
    if (sameRequest && sessionStatsBootstrapTimer && !expedite) return;
    clearSessionStatsBootstrap();
    const pending = { sessionId, generation, started: false };
    sessionStatsBootstrap = pending;
    sessionStatsBootstrapTimer = setTimeout(function () {
      sessionStatsBootstrapTimer = null;
      if (sessionStatsBootstrap !== pending || state.connection !== 'connected' ||
          sessionState.sessionId !== sessionId || client.connectGeneration !== generation) return;
      pending.started = true;
      if (hasSessionComposerMetrics()) {
        settleSessionStatsRequestsIfComplete();
        return;
      }
      safeRequest(client.requestSessionStats(sessionId));
      safeRequest(client.requestContextUsage(sessionId));
      scheduleStatsRetry(sessionId);
    }, delay == null ? 3000 : delay);
  }

  function scheduleSessionBootstrap(sessionId, delay, refreshSessionList) {
    if (sessionBootstrapTimer) clearTimeout(sessionBootstrapTimer);
    const generation = client.connectGeneration;
    sessionBootstrapTimer = setTimeout(function () {
      sessionBootstrapTimer = null;
      if (state.connection !== 'connected' || sessionState.sessionId !== sessionId ||
          generation !== client.connectGeneration) return;
      // Let the latest history request start first; these projections can scan the
      // same host-side session log and otherwise make a newly opened chat feel stuck.
      safeRequest(client.requestQueue(sessionId), uiText('排队队列'));
      scheduleSessionDetailsBootstrap(sessionId, 2500, false, refreshSessionList);
      // If the history reply is slow or missing, hydrate stats after a bounded wait.
      scheduleSessionStatsBootstrap(sessionId, 3000);
    }, delay == null ? 250 : delay);
  }
  const sessionCacheKey = id => {
    const scope = id === sessionState.sessionId && sessionCacheScope !== null
      ? sessionCacheScope : activeCacheScope();
    return scope ? scope + '::' + id : id;
  };
  function historyPageKey(sessionId, beforeSeq, formatVersion) {
    return sessionCacheKey(sessionId) + '::' + String(formatVersion || '') + '::' + String(beforeSeq);
  }
  function serializeSessionCache(value) {
    if (!value.events || !value.events.length) return value;
    const stored = Object.assign({}, value);
    let low = 0, high = value.events.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (utf8ByteLength(JSON.stringify(value.events.slice(middle))) <= 520000) high = middle;
      else low = middle + 1;
    }
    stored.events = value.events.slice(low);
    if (stored.events.length < value.events.length) {
      stored.hasMore = true;
      stored.nextBeforeSeq = stored.events.length ? stored.events[0].seq : value.nextBeforeSeq;
    }
    delete stored.rows;
    return stored;
  }

  function saveSessionCache(sessionId, rows) {
    try {
      if (!sessionId || !rows || !rows.length) return;
      const cached = recentWindow({ rows, events: rawBuffer, stats: sessionState.stats,
        turnUsage: sessionState.turnUsage, savedAt: Date.now(),
        hasMore: sessionState.hasMoreHistory, nextBeforeSeq: sessionState.nextBeforeSeq,
        historyFormatVersion: sessionState.historyFormatVersion }, protocol, sessionId);
      sessionCache.set(sessionCacheKey(sessionId), cached, {
        delayMs: 1000,
        // Rows are a projection of durable events. Avoid storing their duplicated
        // text while retaining row-only legacy/optimistic caches when no events exist.
        serialize: serializeSessionCache
      });
    } catch (e) { /* 存储失败不阻断 */ }
  }

  function normalizeSessionCache(sessionId, cached) {
      if (!cached || (!Array.isArray(cached.events) && !Array.isArray(cached.rows))) return null;
      const restored = recentWindow(cached, protocol, sessionId);
      return restored.rows.length ? restored : null;
  }

  function loadSessionCache(sessionId) {
    const key = sessionCacheKey(sessionId);
    const normalize = cached => normalizeSessionCache(sessionId, cached);
    const cached = sessionCache.get(key, normalize);
    if (cached) return cached;

    // The pre-scoped cache format cannot identify its host. Migrate it only when
    // there is exactly one matching profile; otherwise isolation wins over reuse.
    const scope = sessionId === sessionState.sessionId && sessionCacheScope !== null
      ? sessionCacheScope : activeCacheScope();
    const profiles = state.profiles || [];
    if (!scope || profiles.length !== 1 || profiles[0].id !== scope || typeof wx === 'undefined') return null;
    try {
      const raw = wx.getStorageSync('dsh_session_cache.' + sessionId);
      const legacy = normalize(typeof raw === 'string' ? JSON.parse(raw) : raw);
      if (!legacy) return null;
      sessionCache.set(key, legacy, { delayMs: 1000, serialize: serializeSessionCache });
      return legacy;
    } catch (_error) { return null; }
  }

  /** 首页缓存：按主机档案命名空间存取（对齐 iOS KMP 本地存储） */
  function loadHomeCache(activeID) {
    return homeCache.get(activeID, cached => cached && Array.isArray(cached.sessions) && Array.isArray(cached.workspaces)
      ? cached : null);
  }

  function profilesShareGateway(left, right) {
    if (!left || !right) return false;
    if (left.id && right.id && left.id === right.id) return true;
    if (left.gatewayId && right.gatewayId && left.gatewayId === right.gatewayId) return true;
    const leftEndpoints = left.endpoints || [];
    const rightEndpoints = right.endpoints || [];
    const sharesEndpoint = leftEndpoints.some(function (endpoint) {
      return rightEndpoints.indexOf(endpoint) >= 0;
    });
    return sharesEndpoint && String(left.gatewayName || '') === String(right.gatewayName || '');
  }

  /**
   * 同一台 Gateway 可能因旧版配对流程留下多个 profile ID。缓存仍以 profile ID
   * 分区，但首页应继承同名且共享连接地址的最近成功快照，避免“已连接但列表为空”。
   */
  function loadCompatibleHomeCache(activeID) {
    const direct = loadHomeCache(activeID);
    if (direct && ((direct.sessions || []).length || (direct.workspaces || []).length)) {
      return { cache: direct, profileId: activeID };
    }
    const activeProfile = (state.profiles || []).find(function (profile) {
      return profile.id === activeID;
    });
    if (!activeProfile) return null;
    const candidates = (state.profiles || [])
      .filter(function (profile) {
        return profile.id !== activeID && profilesShareGateway(activeProfile, profile);
      })
      .sort(function (left, right) {
        return (right.lastConnectedAt || 0) - (left.lastConnectedAt || 0);
      });
    for (let i = 0; i < candidates.length; i += 1) {
      const cache = loadHomeCache(candidates[i].id);
      if (cache && ((cache.sessions || []).length || (cache.workspaces || []).length)) {
        return { cache: cache, profileId: candidates[i].id };
      }
    }
    return direct ? { cache: direct, profileId: activeID } : null;
  }

  function saveHomeCache() {
    try {
      if (!state.activeID) return;
      const previousResult = loadCompatibleHomeCache(state.activeID);
      const previous = previousResult ? previousResult.cache : null;
      const sessions = (state.sessions || []).length
        ? state.sessions
        : ((previous && previous.sessions) || []);
      const workspaces = (state.workspaces || []).length
        ? state.workspaces
        : ((previous && previous.workspaces) || []);
      const archivedSessionIds = (state.archivedSessionIds || []).length
        ? state.archivedSessionIds
        : ((previous && previous.archivedSessionIds) || []);
      const currentWorkspaceId = state.isUngroupedWorkspaceSelected ? null : (state.currentWorkspaceId ||
        (previous && previous.currentWorkspaceId) ||
        (workspaces[0] && workspaces[0].workspaceId) || null);
      homeCache.set(state.activeID, {
        sessions: sessions,
        workspaces: workspaces,
        archivedSessionIds: archivedSessionIds,
        currentWorkspaceId: currentWorkspaceId,
        isUngroupedWorkspaceSelected: state.isUngroupedWorkspaceSelected,
        savedAt: Date.now()
      }, { immediate: true });
    } catch (e) { /* 存储失败不阻断 */ }
  }

  function bootstrap() {
    state.rpcError = '';
    if (coreBootstrapTimer) { clearTimeout(coreBootstrapTimer); coreBootstrapTimer = null; }
    const activeSessionId = sessionState.sessionId;
    if (activeSessionId) {
      // Rows survive reconnects, but this new connection still needs an authoritative
      sessionState.cacheDisplay = (sessionState.rows || []).length > 0;
      sessionState.historyState = 'requested';
      sessionState.historyError = '';
      const subscribed = client.subscribe(activeSessionId, sessionResumeCursor());
      if (subscribed && state.connection === 'connected') {
        snapshotPendingFor = activeSessionId;
        scheduleHistoryFallback(activeSessionId);
      } else {
        client.requestHistory(activeSessionId);
        scheduleHistoryRetry(activeSessionId);
      }
      scheduleSessionBootstrap(activeSessionId);
    }
    const generation = client.connectGeneration;
    const requestCoreState = function () {
      if (state.connection !== 'connected' || generation !== client.connectGeneration) return;
      safeRequest(client.requestWorkspaces(), uiText('工作区'), 'workspaces');
      safeRequest(client.requestSessions(), uiText('会话列表'), 'sessions');
      safeRequest(client.requestHost(), uiText('主机信息'), 'host');
      safeRequest(client.requestDefaults(), uiText('默认值'), 'defaults');
      safeRequest(client.requestDefaultModel(), uiText('默认模型'), 'default-model');
      safeRequest(client.requestAgentPresets(), uiText('模式目录'), 'agent-presets');
      // 自动化任务目录曾拉取过：重连后自动刷新（对齐 iOS onReceive gateway.$state）
      if (scheduleLoadedOnce) refreshScheduledTasks();
      // 插件页访问过：重连后确认插件状态（对齐 iOS pluginPageVisited）
      if (pluginPageVisited) refreshPlugins();
    };
    if (activeSessionId) {
      scheduleCoreBootstrap(requestCoreState, 400);
      // 重连后网关不保留订阅与推送状态：需要重拉会话内容。
    } else requestCoreState();
  }

  function restoreHomeCacheAfterCoreFailure(requestType) {
    if (requestType !== 'workspaces' && requestType !== 'sessions') return false;
    if (!state.activeID) return false;
    const cacheResult = loadCompatibleHomeCache(state.activeID);
    if (!cacheResult) return false;
    const cached = cacheResult.cache;
    let restored = false;
    if (requestType === 'sessions' && !(state.sessions || []).length && (cached.sessions || []).length) {
      state.sessions = attachCompletedAt(cached.sessions);
      state.lastSessionsFrame = {
        count: state.sessions.length,
        keys: uiText('本地缓存'),
        at: cached.savedAt || Date.now(),
        cached: true
      };
      restored = true;
    }
    if (requestType === 'workspaces' && !(state.workspaces || []).length && (cached.workspaces || []).length) {
      state.workspaces = cached.workspaces;
      state.archivedSessionIds = cached.archivedSessionIds || state.archivedSessionIds || [];
      state.isUngroupedWorkspaceSelected = cached.isUngroupedWorkspaceSelected === true;
      state.currentWorkspaceId = state.isUngroupedWorkspaceSelected ? null : (cached.currentWorkspaceId ||
        (state.workspaces[0] && state.workspaces[0].workspaceId) || null);
      state.lastWorkspacesFrame = {
        count: state.workspaces.length,
        keys: uiText('本地缓存'),
        at: cached.savedAt || Date.now(),
        cached: true
      };
      restored = true;
    }
    if (restored) state.homeCacheAt = cached.savedAt || state.homeCacheAt || 0;
    return restored;
  }

  function safeRequest(promise, label, requestType) {
    if (promise && promise.catch) {
      promise.then(function () {
        // 任一同类请求成功后，清掉之前残留的诊断；避免 UI 永久显示旧错误。
        if (!state.rpcError || !label || state.rpcError.indexOf(label + uiText('失败：')) === 0) {
          state.rpcError = '';
          emit();
        }
      }, function (err) {
        // 诊断可见化：请求超时/被拒不再静默，主机弹层会显示最近一次失败
        const restored = restoreHomeCacheAfterCoreFailure(requestType);
        const reason = ((err && err.message) || uiText('未知错误'));
        state.rpcError = (label || uiText('请求')) + uiText('失败：') + reason +
          (restored ? uiText('（已显示上次成功加载的数据）') : '');
        emit();
      });
    }
  }

  // 快照优先：openSession 依赖订阅后的 session-snapshot，不再立即补 history。
  let snapshotPendingFor = null;
  let historyFallbackTimer = null;
  let emptyHistoryFallbackKey = null;
  function requestEmptyHistoryFallbackOnce(sessionId, cursor) {
    const key = client.connectGeneration + '::' + String(sessionId || '') + '::' + String(cursor);
    if (!sessionId || emptyHistoryFallbackKey === key) return false;
    emptyHistoryFallbackKey = key;
    // An empty bounded tail with a positive host cursor is not an empty chat.
    if (Number.isSafeInteger(cursor) && cursor >= 0 && cursor < Number.MAX_SAFE_INTEGER &&
        sessionState.historyFormatVersion) {
      sessionState.hasMoreHistory = true;
      sessionState.nextBeforeSeq = cursor + 1;
      if (requestOlderHistory()) return true;
    }
    return client.requestHistory(sessionId);
  }
  function clearHistoryFallback() {
    if (historyFallbackTimer) { clearTimeout(historyFallbackTimer); historyFallbackTimer = null; }
    snapshotPendingFor = null;
  }
  function scheduleHistoryFallback(sessionId) {
    if (historyFallbackTimer) clearTimeout(historyFallbackTimer);
    // 1.2s 足够快照到达（一次宿主读取）；老网关/异常路径下退回 history。
    historyFallbackTimer = setTimeout(function () {
      historyFallbackTimer = null;
      if (snapshotPendingFor !== sessionId) return;
      if (sessionState.sessionId !== sessionId || state.connection !== 'connected') return;
      snapshotPendingFor = null;
      if (String(sessionState.historyState || '').indexOf('loaded') === 0 && !sessionState.cacheDisplay) return;
      client.requestHistory(sessionId);
      scheduleHistoryRetry(sessionId);
    }, 1200);
  }

  /** 历史请求自愈：4s 内没等到 history 帧 → 重发（最多 3 次，之后明确失败） */
  function scheduleHistoryRetry(sessionId) {    if (historyRetryTimer) clearTimeout(historyRetryTimer);
    let attempt = 0;
    const tick = function () {
      historyRetryTimer = null;
      if (!sessionState.sessionId || sessionState.sessionId !== sessionId) return;
      // `loaded:cached` means rows were rendered locally, not that the current
      // tail request succeeded. Keep retrying until an authoritative history frame lands.
      if (String(sessionState.historyState || '').indexOf('loaded') === 0 && !sessionState.cacheDisplay) return;
      attempt += 1;
      if (attempt > 3) {
        sessionState.historyState = 'error:history';
        sessionState.historyError = state.connection === 'connected'
          ? uiText('历史记录加载超时，请检查 Gateway 连接后重试')
          : uiText('Gateway 未连接，无法加载历史记录');
        emit();
        return;
      }
      if (state.connection !== 'connected') {
        historyRetryTimer = setTimeout(tick, 4000);
        return;
      }
      const ok = client.requestHistory(sessionId);
      if (!ok && attempt >= 3) {
        sessionState.historyState = 'error:history';
        sessionState.historyError = uiText('历史请求未发送，请重新连接 Gateway');
        emit();
        return;
      }
      historyRetryTimer = setTimeout(tick, 4000);
    };
    historyRetryTimer = setTimeout(tick, 4000);
  }

  // ---------- 帧路由 ----------

  function handleFrame(frame) {
    if (frame && frame.kind) {
      sessionState.lastFrames = sessionState.lastFrames.slice(-7).concat(frame.kind);
      if (dataWatchdogTimer) { clearTimeout(dataWatchdogTimer); dataWatchdogTimer = null; }
    }
    // 诊断：按帧类型计数（连接期），主机弹窗诊断行可见
    if (frame && frame.kind) {
      state.frameStats = state.frameStats || {};
      state.frameStats[frame.kind] = (state.frameStats[frame.kind] || 0) + 1;
    }
    // 自动化任务帧在会话域之前拦截（对齐 iOS AppStore.handle 顶部的 schedule 路由）
    if (handleScheduleFrame(frame)) return;
    // 插件管理帧（对齐 iOS acceptPluginFrame）
    if (handlePluginFrame(frame)) return;
    if (String(frame.kind || '').indexOf('workspace-changes-') === 0 ||
      frame.kind === 'error' && String(frame.requestType || '').indexOf('workspace-changes-') === 0) return;
    // File transfer replies belong to the file viewer, not conversation projection.
    if (String(frame.kind || '').indexOf('file-download-') === 0 ||
      frame.kind === 'error' && String(frame.requestType || '').indexOf('file-download-') === 0) return;
    if (String(frame.kind || '').indexOf('file-upload-') === 0 ||
      frame.kind === 'error' && String(frame.requestType || '').indexOf('file-upload-') === 0) return;
    // Speech RPCs belong to their requester, never to conversation/history errors.
    if (String(frame.kind || '').indexOf('speech-') === 0 ||
      frame.kind === 'error' && String(frame.requestType || '').indexOf('speech-') === 0) return;
    // 通用错误帧不属于普通会话事件，且通常不携带 sessionId。
    if (frame && frame.kind === 'error') {
      handleSessionFrame(frame);
      return;
    }
    switch (frame.kind) {
      case 'hello':
        state.gatewayCapabilities = Array.isArray(frame.capabilities) ? frame.capabilities : [];
        acceptIdentity(frame);
        state.gatewayName = frame.gatewayName || state.gatewayName;
        state.gatewayMetadata = { name: frame.gatewayPackage || '', version: frame.gatewayVersion || '' };
        state.clientCount = frame.clients;
        if (frame.historyFormatVersion) {
          sessionState.historyFormatVersion = frame.historyFormatVersion;
        }
        emit();
        return;
      case 'workspaces':
        if (!Array.isArray(frame.items)) {
          state.rpcError = uiText('工作区失败：网关返回格式无效');
          restoreHomeCacheAfterCoreFailure('workspaces');
          emit();
          return;
        }
        state.rpcError = '';
        if (!(frame.items || []).length && state.workspaces.length) {
          state.lastWorkspacesFrame = {
            count: state.workspaces.length,
            keys: uiText('本地缓存'),
            at: Date.now(),
            cached: true
          };
          if (Date.now() - (state.lastWorkspaceRetryAt || 0) > 8000
            && (state.workspaceRetries || 0) < 5) {
            state.lastWorkspaceRetryAt = Date.now();
            state.workspaceRetries = (state.workspaceRetries || 0) + 1;
            safeRequest(client.requestWorkspaces(), uiText('工作区'), 'workspaces');
          }
          emit();
          return;
        }
        state.workspaces = frame.items || [];
        state.archivedSessionIds = frame.archivedSessionIds || [];
        saveHomeCache();
        state.lastWorkspacesFrame = {
          count: state.workspaces.length,
          keys: state.workspaces.length ? Object.keys((frame.items || [])[0] || {}).slice(0, 8).join(',') : '',
          at: Date.now()
        };
        if (!state.isUngroupedWorkspaceSelected && !state.currentWorkspaceId && state.workspaces.length) {
          state.currentWorkspaceId = state.workspaces[0].workspaceId;
        }
        // 自愈（对称方向）：工作区到了但会话列表仍为空 → 主动补拉
        if (!state.sessions.length
          && Date.now() - (state.lastSessionsRetryAt || 0) > 8000
          && (state.sessionsRetries || 0) < 5) {
          state.lastSessionsRetryAt = Date.now();
          state.sessionsRetries = (state.sessionsRetries || 0) + 1;
          safeRequest(client.requestSessions(), uiText('会话列表'));
        }
        emit();
        return;
      case 'workspace-create':
        safeRequest(client.requestWorkspaces());
        return;
      case 'sessions': {
        state.rpcError = '';
        const sessionItems = Array.isArray(frame.items)
          ? frame.items
          : (Array.isArray(frame.sessions) ? frame.sessions
            : (frame.data && Array.isArray(frame.data.items) ? frame.data.items : []));
        if (sessionItems.length || !state.sessions.length) {
          const nextSessions = sessionItems.map(mapSessionSummary);
          rememberCompleted(state.sessions, nextSessions);
          state.sessions = attachCompletedAt(nextSessions);
        }
        if (sessionState.sessionId) {
          const activeSession = state.sessions.find(item => item.sessionId === sessionState.sessionId);
          if (activeSession && activeSession.agentPreset != null) {
            setSessionAgentPreset(activeSession.agentPreset, activeSession.agentPresetAsOfSeq, false);
          }
        }
        // 自愈 A：有会话但始终没有工作区数据 → 补拉工作区
        if (!state.workspaces.length && state.sessions.length
          && Date.now() - (state.lastWorkspaceRetryAt || 0) > 10000
          && (state.workspaceRetries || 0) < 5) {
          state.lastWorkspaceRetryAt = Date.now();
          state.workspaceRetries = (state.workspaceRetries || 0) + 1;
          safeRequest(client.requestWorkspaces(), uiText('工作区'));
        }
        // 自愈 B：已连接但主机回了空会话列表 → 节流补拉（0.8.x 偶发空视图）
        if (!sessionItems.length && state.connection === 'connected') {
          if (Date.now() - (state.lastSessionsRetryAt || 0) > 8000
            && (state.sessionsRetries || 0) < 5) {
            state.lastSessionsRetryAt = Date.now();
            state.sessionsRetries = (state.sessionsRetries || 0) + 1;
            safeRequest(client.requestSessions(), uiText('会话列表'));
          } else if ((state.sessionsRetries || 0) >= 5
            && Date.now() - (state.lastSessionsRetryAt || 0) > 8000
            && typeof client.handleTransportFailure === 'function') {
            // 重试预算用尽：判定线路/主机半死，断链交给端点轮换
            state.lastSessionsRetryAt = Date.now();
            client.handleTransportFailure(uiText('会话列表持续为空，正在重新连接'));
          }
        }
        // 空帧不落缓存：避免瞬时空响应抹掉「秒加载」用的上次列表
        state.lastSessionsFrame = {
          count: state.sessions.length,
          keys: sessionItems.length
            ? Object.keys(sessionItems[0] || {}).slice(0, 6).join(',')
            : (state.sessions.length ? uiText('本地缓存') : (uiText('帧[') + Object.keys(frame).slice(0, 8).join(',') + ']')),
          at: Date.now(),
          cached: !sessionItems.length && !!state.sessions.length
        };
        {
          // 服务器侧运行标志是全局事实来源：桌面端/其他设备发起的运行同样生效
          const activeId = sessionState.sessionId;
          if (activeId) {
            const mine = state.sessions.find((x) => x.sessionId === activeId);
            if (mine) {
              runProbeMisses = 0;
              // A sessions response may have been produced before a live turn
              const streamFresh = Date.now() - (sessionState.lastEventAt || 0) < RUN_IDLE_THRESHOLD_MS;
              if (streamFresh) {
                mine.running = sessionState.running;
                mine.updatedAt = Math.max(Number(mine.updatedAt) || 0, sessionState.lastEventAt || 0);
              } else if (mine.running !== sessionState.running) setRunning(mine.running);
            } else if (sessionState.running) {
              // 该会话已不在列表（归档/删除）：连续探测仍未出现则结束运行态
              runProbeMisses += 1;
              if (runProbeMisses >= 3) setRunning(false);
            }
          }
        }
        if (sessionItems.length) saveHomeCache();
        emit();
        return;
      }
      case 'search':
        state.searchResults = (frame.items || []);
        emit();
        return;
      case 'host':
        state.rpcError = '';
        state.host = normalizeHostInfo(frame);
        if (frame.gatewayVersion) {
          state.gatewayMetadata = { name: frame.gatewayPackage || '', version: frame.gatewayVersion };
        }
        emit();
        return;
      case 'defaults':
        state.defaults = {
          agentPresetDefault: frame.agentPresetDefault,
          permissionDefault: frame.permissionDefault
        };
        saveDefaults(state.defaults);
        emit();
        return;
      case 'default-model':
      case 'save-default-model':
        state.defaultModel = frame.selection || frame.saved || state.defaultModel;
        emit();
        return;
      case 'set-default':
        safeRequest(client.requestDefaults());
        return;
      case 'agent-presets':
        state.agentPresets = {
          presets: frame.presets || [],
          authorable: frame.authorable,
          hasDocument: frame.hasDocument
        };
        emit();
        return;
      case 'models':
        state.modelCatalog = {
          current: frame.current || null,
          routable: frame.routable !== false,
          groups: frame.groups || []
        };
        emit();
        return;
      case 'pong':
        return;
      default:
        break;
    }

    // 会话域：已打开会话时，匹配 sessionId 或省略 sessionId 的会话域帧都按当前会话处理
    const SESSION_SCOPED = {
      'history': 1,
      'session-snapshot': 1,
      'event': 1,
      'session-stats': 1,
      'context-usage': 1,
      'context-dashboard': 1,
      'context-fleet': 1,
      'permission-options': 1,
      'session-agent-preset': 1,
      'session-queues': 1,
      'session-queue': 1,
      'queue-item-updated': 1,
      'commands': 1,
      'command-options': 1,
      'command-selected': 1,
      'command-executed': 1,
      'tasks': 1,
      'tasks-updated': 1,
      'goal': 1,
      'goal-updated': 1,
      'goal-edited': 1,
      'goal-paused': 1,
      'goal-resumed': 1,
      'goal-cleared': 1,
      'assistant-stream': 1,
      'assistant-stream-v1': 1,
      'assistant-message': 1,
      'assistant/message': 1    };
    if (frame.sessionId && frame.sessionId === sessionState.sessionId) {
      handleSessionFrame(frame);
    } else if (sessionState.sessionId && (!frame.sessionId || frame.sessionId === sessionState.sessionId)
      && (frame.kind === 'assistant-stream' || frame.kind === 'assistant-stream-v1')) {
      // 流式正文可能带/不带 sessionId，按当前订阅会话接收
      handleAssistantStream(frame);
    } else if (sessionState.sessionId && !frame.sessionId && SESSION_SCOPED[frame.kind]) {
      handleSessionFrame(frame);
    } else if (frame.kind && frame.sessionId && sessionState.sessionId) {
      // 诊断：sessionId 不匹配——记录两侧尾部片段
      sessionState.lastFrames = sessionState.lastFrames.slice(-7).concat(
        'MISMATCH:' + String(frame.sessionId).slice(-8) + '!=' + String(sessionState.sessionId).slice(-8)
      );
      emit();
    }
  }


  // ---------- 会话统计补拉 ----------
  let statsRetryTimer = null;
  let statsRetrySession = null;
  let statsRetryAttempt = 0;
  const STATS_RETRY_DELAYS = [2500, 5000, 10000, 20000];

  function clearStatsRetry() {
    if (statsRetryTimer) { clearTimeout(statsRetryTimer); statsRetryTimer = null; }
    statsRetrySession = null;
    statsRetryAttempt = 0;
  }

  function hasSessionComposerMetrics() {
    const bundle = sessionState.stats || {};
    const stats = bundle.stats || {};
    const usage = bundle.tokenUsage || stats.tokenUsage || {};
    const totals = usage.totals || {};
    const tokenValue = (name) => {
      const value = usage[name] != null ? usage[name] : totals[name];
      const number = Number(value);
      return value != null && Number.isFinite(number) && number >= 0 ? number : null;
    };
    const outputTokens = tokenValue('outputTokens');
    const hasDisjointInput = ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens']
      .every((name) => tokenValue(name) != null);
    const hasAggregateInput = tokenValue('inputTokens') != null;
    const hasTokens = outputTokens != null && (hasDisjointInput || hasAggregateInput);
    const pressure = [bundle.pressure, stats.pressure, stats].find((item) => (
      item && item.contextWindow != null && (item.projectedTokens != null || item.pressureTokens != null)
    ));
    const usedTokens = pressure && (pressure.projectedTokens != null
      ? pressure.projectedTokens : pressure.pressureTokens);
    return hasTokens && !!(pressure && Number(pressure.contextWindow) > 0 &&
      Number.isFinite(Number(usedTokens)) && Number(usedTokens) >= 0);
  }

  function settleSessionStatsRequestsIfComplete() {
    if (!hasSessionComposerMetrics()) return;
    clearSessionStatsBootstrap();
    clearStatsRetry();
  }

  function scheduleStatsRetry(sessionId) {
    clearStatsRetry();
    if (!sessionId || state.connection !== 'connected') return;
    statsRetrySession = sessionId;
    statsRetryAttempt = 0;
    const tick = function () {
      statsRetryTimer = null;
      if (sessionState.sessionId !== statsRetrySession || state.connection !== 'connected') return;
      if (hasSessionComposerMetrics()) {
        clearStatsRetry();
        return;
      }
      if (statsRetryAttempt >= STATS_RETRY_DELAYS.length) return;
      const delay = STATS_RETRY_DELAYS[statsRetryAttempt];
      statsRetryAttempt += 1;
      statsRetryTimer = setTimeout(tick, delay);
      safeRequest(client.requestSessionStats(statsRetrySession));
      // context-usage 同帧提供 Token 分项与上下文压力，一起补拉
      safeRequest(client.requestContextUsage(statsRetrySession));
    };
    statsRetryTimer = setTimeout(tick, STATS_RETRY_DELAYS[0]);
  }

  // ---------- 运行态兜底 ----------
  let runProbeTimer = null;
  let runProbeMisses = 0;
  let lastIdleHistoryAt = 0;
  const RUN_IDLE_PROBE_MS = 4000;
  const RUN_IDLE_THRESHOLD_MS = 5000;
  // 兜底补拉历史的最小间隔：Host 每次都要重读整段会话日志，拉太频会拖慢桌面端。
  const RUN_IDLE_HISTORY_GAP_MS = 20000;

  function noteSessionActivity() {
    sessionState.lastEventAt = Date.now();
  }

  function clearRunProbe() {
    if (runProbeTimer) { clearInterval(runProbeTimer); runProbeTimer = null; }
  }

  function setRunning(value) {
    const next = value === true;
    runProbeMisses = 0;
    const activeId = sessionState.sessionId;
    const summary = activeId && (state.sessions || []).find(function (item) {
      return item && item.sessionId === activeId;
    });
    if (summary && summary.running !== next) {
      state.sessions = state.sessions.map(function (item) {
        return item && item.sessionId === activeId
          ? Object.assign({}, item, { running: next, updatedAt: Date.now() })
          : item;
      });
      saveHomeCache();
    }
    if (sessionState.running === next) {
      if (next && !runProbeTimer) scheduleRunProbe();
      // 运行态未变但面板可能刚切到前台：补一次轮询调度（可见且运行中才启动）。
      syncContextPolling();
      syncFleetPolling();
      return;
    }
    sessionState.running = next;
    if (next) {
      noteSessionActivity();
      scheduleRunProbe();
    } else {
      clearRunProbe();
      // 权威结束：清掉残留的流式标记，避免页面继续显示“正在生成”
      (sessionState.rows || []).forEach(function (row) {
        if (row && row.kind === 'assistant') {
          row.streaming = false;
          row.reasoningStreaming = false;
          row.title = '';
        }
      });
    }
    // 运行中才自动刷新；停止后立即清 timer（面板保留最后一帧值）。
    syncContextPolling();
    syncFleetPolling();
  }

  function scheduleRunProbe() {
    if (runProbeTimer) return;
    runProbeTimer = setInterval(function () {
      if (!sessionState.running) { clearRunProbe(); return; }
      if (!sessionState.sessionId || state.connection !== 'connected') return;
      const idle = Date.now() - (sessionState.lastEventAt || 0);
      if (idle < RUN_IDLE_THRESHOLD_MS) return;
      // 安静太久：拉一次会话列表校准 running，并补拉会话尾部，
      safeRequest(client.requestSessions());
      if (Date.now() - lastIdleHistoryAt < RUN_IDLE_HISTORY_GAP_MS) return;
      if (sessionState.historyState !== 'requested' && !olderHistoryPending) {
        lastIdleHistoryAt = Date.now();
        safeRequest(client.requestHistory(sessionState.sessionId));
      }
    }, RUN_IDLE_PROBE_MS);
  }

  // 助手消息结算后：若该条消息不含工具调用、也没有未完成工具，
  let settleClearTimer = null;
  function scheduleSettleClear() {
    if (settleClearTimer) clearTimeout(settleClearTimer);
    settleClearTimer = setTimeout(function () {
      settleClearTimer = null;
      if (!sessionState.running) return;
      if (Date.now() - (sessionState.lastEventAt || 0) < 1400) return;
      setRunning(false);
      emit();
    }, 1600);
  }

  /** 结算判定：无工具调用且无未完成工具 → 最终答复，安排短宽限结束运行态 */
  function noteAssistantSettlement(data) {
    noteSessionActivity();
    const blocks = (data && data.message && data.message.content) || [];
    const hasToolCall = (Array.isArray(blocks) && blocks.some(function (b) { return b && b.type === 'tool-call'; }))
      || !!(data && Array.isArray(data.toolCalls) && data.toolCalls.length);
    const rows = sessionState.rows || [];
    let lastAssistant = null;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i] && rows[i].kind === 'assistant') { lastAssistant = rows[i]; break; }
    }
    const pendingTool = !!(lastAssistant && (lastAssistant.tools || []).some(function (t) { return t.status !== 'done'; }));
    if (!hasToolCall && !pendingTool) scheduleSettleClear();
  }

  let streamFlushTimer = null;
  let liveAttempt = null;
  let liveAttemptSerial = 0;

  function clearLiveAttempt() {
    liveAttempt = null;
    if (streamFlushTimer) clearTimeout(streamFlushTimer);
    streamFlushTimer = null;
  }

  function promoteCachedRows() {
    if (!sessionState.cacheDisplay) return;
    const agg = protocol.newAggregator();
    agg.rows = JSON.parse(JSON.stringify(sessionState.rows || []));
    agg.rows.forEach(row => {
      (row.tools || []).forEach(tool => { if (tool.callId) agg.byCallId[tool.callId] = tool; });
    });
    sessionState.rowsAgg = agg;
    sessionState.cacheDisplay = false;
  }

  function beginLiveAttempt(payload) {
    liveAttempt = { sessionId: sessionState.sessionId, id: payload.attemptId,
      turn: payload.turn, step: payload.step, seq: -(++liveAttemptSerial),
      nextIndex: 0, chunks: [], row: null };
  }

  function replayLiveAttempt() {
    if (!liveAttempt || liveAttempt.sessionId !== sessionState.sessionId) return;
    const settled = rawBuffer.some(raw => {
      const data = raw.data || {};
      return ['assistant/message', 'assistant/attempt', 'turn/end'].includes(raw.type)
        && data.turn === liveAttempt.turn
        && (raw.type === 'turn/end' || data.step === liveAttempt.step);
    });
    if (settled) return;
    liveAttempt.chunks.forEach(raw => protocol.applyEvent(sessionState.rowsAgg, protocol.normalizeRawEvent(raw, sessionState.sessionId)));
    liveAttempt.row = sessionState.rowsAgg.currentAssistant;
    sessionState.rows = sessionState.rowsAgg.rows.slice();
  }

  function installAssistantBaseline(frame) {
    const baseline = frame.assistantStream;
    if (!baseline) return;
    clearLiveAttempt();
    const active = baseline.activeAttempt;
    if (!active) return;
    beginLiveAttempt(active);
    setRunning(true);
    (active.stream || []).forEach(record => {
      let chunk;
      if (record.type === 'chunk') chunk = record.chunk;
      else if (record.type === 'text-chunks' || record.type === 'reasoning-chunks') {
        chunk = { type: record.type === 'text-chunks' ? 'text-delta' : 'reasoning-delta', text: (record.texts || []).join('') };
      } else if (record.type === 'tool-call-chunks') {
        chunk = { type: 'tool-call-delta', id: record.id, name: record.name, argumentsDelta: (record.args || []).join('') };
      }
      if (chunk) handleAssistantStream({ frame: { type: 'chunk', attemptId: active.attemptId, turn: active.turn, step: active.step, chunk } }, true);
    });
    liveAttempt.nextIndex = active.nextIndex || 0;
  }

  function mergeMetricProjection(previous, incoming) {
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return previous || null;
    const merged = Object.assign({}, previous || {}, incoming);
    if (incoming.totals && typeof incoming.totals === 'object' && !Array.isArray(incoming.totals)) {
      merged.totals = Object.assign({}, previous && previous.totals || {}, incoming.totals);
    }
    if (incoming.pressure && typeof incoming.pressure === 'object' && !Array.isArray(incoming.pressure)) {
      merged.pressure = Object.assign({}, previous && previous.pressure || {}, incoming.pressure);
    }
    return merged;
  }

  function setSessionAgentPreset(agentPreset, asOfSeq, authoritative) {
    if (typeof agentPreset !== 'string') return false;
    if (!authoritative && sessionState.agentPresetAuthoritative) return false;
    const seq = Number.isSafeInteger(asOfSeq) ? asOfSeq
      : (asOfSeq != null && Number.isSafeInteger(Number(asOfSeq)) ? Number(asOfSeq) : null);
    const previousSeq = sessionState.agentPresetAsOfSeq;
    if (seq != null && previousSeq != null && seq < previousSeq) return false;
    sessionState.agentPreset = agentPreset;
    if (seq != null) sessionState.agentPresetAsOfSeq = seq;
    if (authoritative) sessionState.agentPresetAuthoritative = true;
    return true;
  }

  function mergeSessionPresetProjection(frame) {
    const source = frame || {};
    const projections = source.projections || {};
    const values = projections.values || projections;
    if (!values || typeof values.agentPreset !== 'string') return false;
    const asOfSeq = projections.asOfSeq != null ? projections.asOfSeq : source.asOfSeq;
    return setSessionAgentPreset(values.agentPreset, asOfSeq, false);
  }

  function mergeSessionMetricFrames(frame) {
    const source = frame || {};
    const projections = source.projections || {};
    const values = projections.values || projections;
    const stats = source.sessionStats || values.sessionStats || source.stats;
    const tokenUsage = source.tokenUsage || values.tokenUsage || stats && stats.tokenUsage;
    const pressure = source.contextPressure || source.pressure || values.contextPressure ||
      stats && stats.pressure;
    const previous = sessionState.stats || {};
    const incomingSeq = Number(projections.asOfSeq != null ? projections.asOfSeq : source.asOfSeq);
    const previousSeq = Number(previous.asOfSeq);

    if (!stats && !tokenUsage && !pressure) return;
    if (Number.isSafeInteger(incomingSeq) && Number.isSafeInteger(previousSeq) && incomingSeq < previousSeq) return;
    sessionState.stats = {
      stats: mergeMetricProjection(previous.stats, stats),
      tokenUsage: mergeMetricProjection(previous.tokenUsage, tokenUsage),
      pressure: mergeMetricProjection(previous.pressure, pressure),
      asOfSeq: Number.isSafeInteger(incomingSeq)
        ? Math.max(Number.isSafeInteger(previousSeq) ? previousSeq : incomingSeq, incomingSeq)
        : previous.asOfSeq
    };
  }

  function hydrateSessionMetricsFromFrame(frame) {
    mergeSessionMetricFrames(frame);
    settleSessionStatsRequestsIfComplete();
  }

  function addRunCue(activity, at) {
    if (!sessionState.sessionId || !activity) return;
    const time = at || Date.now();
    const cues = sessionState.runCues || (sessionState.runCues = []);
    // transient chunks can arrive many times per second; keep only the latest cue.
    if (cues.length && cues[cues.length - 1].activity === activity && cues[cues.length - 1].transient) {
      cues[cues.length - 1].at = time;
      return;
    }
    cues.push({ activity: activity, at: time, transient: true });
  }

  /** assistant-stream 帧 → 聚合器 assistant/chunk 事件（正文 text 与参数 argumentsDelta） */
  function handleAssistantStream(frame, restoring) {
    const payload = frame.frame || frame.data || frame.payload || frame;
    const streamType = payload.type || frame.streamType || 'chunk';
    if (streamType === 'start') {
      promoteCachedRows();
      beginLiveAttempt(payload);
      setRunning(true);
      noteSessionActivity();
      return;
    }
    if (streamType === 'end') {
      if (!liveAttempt || liveAttempt.sessionId !== sessionState.sessionId || (payload.attemptId && payload.attemptId !== liveAttempt.id)) return;
      if (payload.outcome && payload.outcome.kind === 'abandoned' && liveAttempt.row && !liveAttempt.row.settled) {
        const agg = sessionState.rowsAgg, row = liveAttempt.row;
        agg.rows = agg.rows.filter(item => item !== row);
        Object.keys(agg.byCallId).forEach(id => { if ((row.tools || []).includes(agg.byCallId[id])) delete agg.byCallId[id]; });
        if (agg.currentAssistant === row) agg.currentAssistant = null;
        sessionState.rows = agg.rows.slice();
      }
      clearLiveAttempt();
      emit();
      return;
    }
    if (streamType !== 'chunk' && streamType !== 'delta' && streamType !== 'text') return;
    if (liveAttempt && liveAttempt.sessionId === sessionState.sessionId && payload.attemptId && liveAttempt.id && payload.attemptId !== liveAttempt.id) return;
    if (!liveAttempt || liveAttempt.sessionId !== sessionState.sessionId
      || liveAttempt.turn !== payload.turn || liveAttempt.step !== payload.step) beginLiveAttempt(payload);
    if (typeof payload.index === 'number') {
      if (payload.index < liveAttempt.nextIndex) return;
      liveAttempt.nextIndex = payload.index + 1;
    }
    const chunk = payload.chunk || payload.delta || payload;
    const text = typeof chunk.text === 'string' ? chunk.text
      : (typeof chunk.delta === 'string' ? chunk.delta
      : (typeof chunk.content === 'string' ? chunk.content : (typeof payload.text === 'string' ? payload.text : '')));
    const argsDelta = typeof chunk.argumentsDelta === 'string' ? chunk.argumentsDelta
      : (typeof chunk.arguments_delta === 'string' ? chunk.arguments_delta : '');
    const toolBlockEnd = chunk.type === 'block-end' && chunk.block && chunk.block.type === 'tool-call';
    if (!text && !argsDelta && !toolBlockEnd && !(chunk.type === 'tool-call-delta' && (chunk.id || chunk.name))) return;
    promoteCachedRows();
    // A subscriber may join after turn/start. Live deltas still establish activity.
    const tail = (sessionState.rows || []).slice().reverse().find(row => row.kind === 'assistant');
    const closedTurn = tail && tail.turnClosed && (payload.turn === undefined || tail.turn === payload.turn);
    if (!closedTurn) setRunning(true);
    noteSessionActivity();
    addRunCue('composing', frame.time ? util.eventDateMs(frame.time) : Date.now());
    const raw = {
      type: 'assistant/chunk',
      seq: liveAttempt.seq,
      time: frame.time || Date.now() / 1000,
      data: {
        turn: payload.turn,
        step: payload.step,
        chunk: {
          type: chunk.type || (argsDelta ? 'tool-call-delta' : 'text'),
          text: text,
          argumentsDelta: argsDelta,
          block: toolBlockEnd ? chunk.block : undefined,
          name: chunk.name || null,
          id: chunk.id || null
        }
      }
    };
    if (!sessionState.rowsAgg) sessionState.rowsAgg = protocol.newAggregator();
    const firstContent = liveAttempt.chunks.length === 0;
    try {
      protocol.applyEvent(sessionState.rowsAgg, protocol.normalizeRawEvent(raw, sessionState.sessionId));
      liveAttempt.chunks.push(raw);
      liveAttempt.row = sessionState.rowsAgg.currentAssistant;
      sessionState.rows = sessionState.rowsAgg.rows.slice();
      if (text) {
        sessionState.lastAssistantText = (sessionState.lastAssistantText || '') + text;
      }
    } catch (e) { /* 单帧失败不中断 */ }
    if (restoring) return;
    if (firstContent) { emit(); return; }
    // 流式 chunk 频率极高：120ms 合帧刷新，避免逐 token 全页 setData 饿死连接层
    if (!streamFlushTimer) {
      streamFlushTimer = setTimeout(function () {
        streamFlushTimer = null;
        emit();
      }, 120);
    }
  }

  let artifactRefresh = null;
  function refreshArtifactsSoon() {
    if (artifactRefresh) clearTimeout(artifactRefresh);
    const id = sessionState.sessionId, generation = client.connectGeneration;
    artifactRefresh = setTimeout(() => {
      artifactRefresh = null;
      if (id === sessionState.sessionId && generation === client.connectGeneration && state.connection === 'connected') client.requestHistory(id);
    }, 80);
  }

  function handleSessionFrame(frame) {
    if (frame.kind === 'assistant-stream' || frame.kind === 'assistant-stream-v1') {
      handleAssistantStream(frame);
      return;
    }
    switch (frame.kind) {
      case 'session-agent-preset':
      case 'session-agent-preset-updated':
      case 'select-agent-preset':
        // 会话级 Agent 预设当前值；锁定状态单向生效
        if (frame.agentPreset !== undefined && frame.agentPreset !== null) {
          if (setSessionAgentPreset(frame.agentPreset, frame.asOfSeq, true)) emit();
        }
        return;
      case 'assistant-message':
      case 'assistant/message': {
        const message = frame.event || frame.message || frame.data || frame;
        const messageData = message.message ? message : { message: message };
        const raw = {
          type: 'assistant/message',
          seq: frame.seq || message.seq || Date.now(),
          time: frame.time || message.time || Date.now() / 1000,
          data: messageData
        };
        ingestEvents([raw]);
        noteSessionActivity();
        // assistant/message 是 durable settlement，不等于 turn 关闭；
        noteAssistantSettlement(messageData);
        emit();
        return;
      }
      case 'event': {
        const evs = frame.events || [];
        if (typeof frame.seq === 'number' && frame.event) {
          const raw = {
            type: frame.event.type || 'unknown',
            seq: frame.seq,
            time: frame.time || Date.now() / 1000,
            surfaceOp: frame.surfaceOp,
            sourceEventSeqs: frame.sourceEventSeqs,
            data: frame.event.data || frame.event
          };
          ingestEvents([raw]);
          refreshStatsSoon();
        } else if (evs.length) {
          ingestEvents(evs);
        }
        // 运行状态：从事件流中检测 turn 边界（多路径覆盖）
        const allEvents = [];
        if (evs.length) allEvents.push(...evs);
        if (frame.event) allEvents.push(frame.event);
        for (const ev of allEvents) {
          const t = ev.type || (ev.event && ev.event.type) || '';
          const data = ev.data || ev.event && (ev.event.data || ev.event) || ev;
          // Legacy gateways forward only the type of these durable events.
          if ((t === 'deliverables/presented' && (!Array.isArray(data.files) || !data.callId || !Number.isSafeInteger(data.turn))) ||
              (t === 'workspace/changes' && !Number.isSafeInteger(data.turn))) refreshArtifactsSoon();
          if (t === 'turn/start') {
            setRunning(true);
            sessionState.lastAssistantText = '';
          }
          if (t === 'turn/end') setRunning(false);
          if (t === 'assistant/message') noteAssistantSettlement(ev.data || ev.event && ev.event.data || ev);
          noteSessionActivity();
        }
        emit();
        return;
      }
      case 'history': {
        if (!frame.cachedLocal) {
          if (sessionState.collaboration.sessionId !== sessionState.sessionId) sessionState.collaboration = collaboration.create(sessionState.sessionId);
          collaboration.baseline(sessionState.collaboration, frame.projections);
          hydrateSessionMetricsFromFrame(frame);
        }
        const events = frame.events || [];
        const pendingPage = olderHistoryPending && olderHistoryPending.id === sessionState.sessionId &&
          olderHistoryPending.generation === client.connectGeneration ? olderHistoryPending : null;
        const minSeq = events.reduce(function (min, event) {
          return Number.isSafeInteger(event && event.seq) ? Math.min(min, event.seq) : min;
        }, Infinity);
        const noProgressPage = !!(pendingPage && events.length === 0 &&
          (frame.beforeSeqPlaceholder || frame.beforeSeq === pendingPage.cursor ||
            frame.nextBeforeSeq === pendingPage.cursor));
        const isOlderPage = !!(pendingPage && (frame.beforeSeqPlaceholder || minSeq < pendingPage.cursor ||
          frame.beforeSeq === pendingPage.cursor ||
          Number.isSafeInteger(frame.nextBeforeSeq) && frame.nextBeforeSeq < pendingPage.cursor || noProgressPage));
        // Tail refreshes can finish while an older-page request is still in flight.
        const isCompetingTail = !!(pendingPage && !isOlderPage && !frame.resetRequired);
        const localLatestSeq = sessionResumeCursor();
        const staleHistoryTail = !pendingPage && !isCompetingTail && !frame.resetRequired &&
          Number.isSafeInteger(frame.cursor) && localLatestSeq !== undefined && frame.cursor < localLatestSeq;
        const emptyNonZeroTail = !pendingPage && !isCompetingTail && events.length === 0
          && Number.isSafeInteger(frame.cursor) && frame.cursor >= 0
          && (frame.cursor > 0 || frame.hasMore === true)
          && (localLatestSeq === undefined || frame.cursor > localLatestSeq);
        if (!staleHistoryTail && !isOlderPage && !frame.cachedLocal) mergeSessionPresetProjection(frame);
        if (pendingPage && isOlderPage) sessionState.historyLastPageBytes = utf8ByteLength(JSON.stringify(events));
        if (pendingPage && isOlderPage && !frame.cachedLocal && minSeq !== Infinity) {
          historyPageCache.set(historyPageKey(sessionState.sessionId, pendingPage.cursor,
            frame.historyFormatVersion || sessionState.historyFormatVersion), {
            sessionId: sessionState.sessionId,
            beforeSeq: pendingPage.cursor,
            events,
            hasMore: frame.hasMore === true,
            nextBeforeSeq: frame.nextBeforeSeq,
            historyFormatVersion: frame.historyFormatVersion || sessionState.historyFormatVersion
          }, { delayMs: 500 });
        }
        sessionState.historyError = '';
        sessionState.cacheDisplay = (staleHistoryTail || events.length === 0) && sessionState.rows.length > 0;
        if (historyRetryTimer) { clearTimeout(historyRetryTimer); historyRetryTimer = null; }
        sessionState.historyState = (staleHistoryTail || events.length === 0) && sessionState.rows.length
          ? 'loaded:cached'
          : 'loaded:' + events.length + 'ev' + (sessionState.ingestErrors ? '+' + sessionState.ingestErrors + 'bad' : '');
        if (frame.resetRequired) {
          sessionState.rowsAgg = protocol.newAggregator();
          setRawBuffer([]);
        }
        const prepend = !!frame.beforeSeqPlaceholder || rawBuffer.length > 0 || sessionState.rows.length > 0;
        ingestEvents(events, prepend);
        if (!isCompetingTail && !staleHistoryTail) {
          sessionState.hasMoreHistory = frame.hasMore === true;
          sessionState.nextBeforeSeq = frame.nextBeforeSeq;
        }
        if (frame.historyFormatVersion && !staleHistoryTail) sessionState.historyFormatVersion = frame.historyFormatVersion;
        saveSessionCache(sessionState.sessionId, sessionState.rows);
        if (!isOlderPage) {
          scheduleSessionDetailsBootstrap(sessionState.sessionId, 150, true);
          if (!hasSessionComposerMetrics()) scheduleSessionStatsBootstrap(sessionState.sessionId, 700, true);
          else settleSessionStatsRequestsIfComplete();
        }
        if (noProgressPage && frame.hasMore !== false) {
          // A relay page can be empty when one older event exceeds its small frame
          // budget. Retry that cursor with a bounded larger frame before showing an error.
          if (retryOlderHistoryWithLargerBudget(pendingPage)) {
            emit();
            return;
          }
          sessionState.historyError = uiText('记录同步暂时中断，请重试');
        } else if (noProgressPage) {
          // We only request a page when the host reported a non-empty cursor;
          // an empty terminal page therefore signals a host/index inconsistency.
          sessionState.historyError = uiText('记录同步暂时中断，请重试');
        }
        if (emptyNonZeroTail) requestEmptyHistoryFallbackOnce(sessionState.sessionId, frame.cursor);
        if (pendingPage && (isOlderPage || frame.resetRequired)) finishHistoryPage();
        else if (!pendingPage && !olderHistoryPending) finishHistoryPage();
        emit();
        return;
      }
      case 'session-snapshot': {
        const snapshotCursor = Number.isSafeInteger(frame.cursor) ? frame.cursor : null;
        const localLatestSeq = sessionResumeCursor();
        const staleSnapshot = !frame.resetRequired && frame.replace === true && snapshotCursor !== null &&
          localLatestSeq !== undefined && snapshotCursor < localLatestSeq;
        if (staleSnapshot) {
          // A delayed reconnect snapshot must not roll a newer local/live tail
          // backward or replace its projections and pagination cursor.
          if (snapshotPendingFor === sessionState.sessionId) clearHistoryFallback();
          if (historyRetryTimer) { clearTimeout(historyRetryTimer); historyRetryTimer = null; }
          sessionState.cacheDisplay = sessionState.rows.length > 0;
          sessionState.historyState = sessionState.cacheDisplay ? 'loaded:cached' : 'requested';
          client.requestHistory(sessionState.sessionId);
          emit();
          return;
        }
        mergeSessionPresetProjection(frame);
        if (sessionState.collaboration.sessionId !== sessionState.sessionId) sessionState.collaboration = collaboration.create(sessionState.sessionId);
        collaboration.baseline(sessionState.collaboration, frame.projections);
        hydrateSessionMetricsFromFrame(frame);
        sessionState.cacheDisplay = !(frame.events || []).length && sessionState.rows.length > 0;
        // 快照就是权威内容：撤销「等快照」状态，超时回落的 history 不再需要。
        if (snapshotPendingFor && snapshotPendingFor === sessionState.sessionId) clearHistoryFallback();
        if (historyRetryTimer) { clearTimeout(historyRetryTimer); historyRetryTimer = null; }
        if (frame.assistantStream) clearLiveAttempt();
        sessionState.historyFormatVersion = frame.historyFormatVersion || sessionState.historyFormatVersion;
        if (frame.cursor !== undefined) sessionState.nextBeforeSeq = frame.cursor;
        const snapEvents = frame.events || [];
        const emptyOpeningPage = snapEvents.length === 0 && Number.isSafeInteger(frame.cursor) && frame.cursor >= 0
          && (frame.hasMore === true || frame.cursor > 0)
          && (localLatestSeq === undefined || frame.cursor > localLatestSeq);
        if (frame.replace) {
          if (frame.assistantStream || snapEvents.length || !sessionState.rows.length) {
            // replace 仅替换快照覆盖的尾部；保留已经分页补齐的更早记录。
            const firstSeq = snapEvents.reduce((min, event) => Math.min(min, event.seq), Infinity);
            const older = !frame.resetRequired && Number.isFinite(firstSeq)
              ? rawBuffer.filter(event => event.seq < firstSeq) : [];
            sessionState.rowsAgg = protocol.newAggregator();
            sessionState.rows = [];
            setRawBuffer([]);
            runCueWatermark = -1;
            ingestEvents(older.concat(snapEvents));
            // 流式正文保护：快照未携带当前回复时回填最近流式文本（对齐 iOS 生成前缀恢复）
            const hasAssistantText = sessionState.rows.some(
              (r) => r.kind === 'assistant' && r.text
            );
            if (!frame.assistantStream && sessionState.lastAssistantText && !hasAssistantText && sessionState.rowsAgg) {
              try {
                protocol.applyEvent(sessionState.rowsAgg, protocol.normalizeRawEvent({
                  type: 'assistant/chunk', seq: 0, time: Date.now() / 1000,
                  data: { chunk: { type: 'text', text: sessionState.lastAssistantText } }
                }, sessionState.sessionId));
                sessionState.rows = sessionState.rowsAgg.rows.slice();
              } catch (e) { /* 回填失败不阻断 */ }
            }
          }
          // 空快照不当作清空指令（0.8.x 完成时可能先推空快照再推历史）
        } else {
          ingestEvents(snapEvents);
        }
        installAssistantBaseline(frame);
        // 快照本身就是权威历史帧：无论有没有 assistantStream，都要把
        sessionState.historyState = snapEvents.length === 0 && sessionState.rows.length
          ? 'loaded:cached'
          : 'loaded:' + snapEvents.length + 'ev' + (sessionState.ingestErrors ? '+' + sessionState.ingestErrors + 'bad' : '');
        if (frame.assistantStream) {
          sessionState.hasMoreHistory = frame.hasMore === true;
          sessionState.nextBeforeSeq = frame.nextBeforeSeq;
        }
        if (frame.hasMore !== undefined) sessionState.hasMoreHistory = frame.hasMore === true;
        saveSessionCache(sessionState.sessionId, sessionState.rows);
        const incompleteReplay = frame.recovery === 'snapshot' && Number.isSafeInteger(frame.resumeFromSeq) &&
          Number.isSafeInteger(frame.resumeToSeq) && frame.resumeToSeq > frame.resumeFromSeq;
        if (emptyOpeningPage) requestEmptyHistoryFallbackOnce(sessionState.sessionId, frame.cursor);
        else if (incompleteReplay) {
          // The gateway could not prove a complete replay interval (e.g. its
          client.requestHistory(sessionState.sessionId);
        }
        // 快照落地后同样加速补一次统计（与 history 路径一致），
        // 否则要等 openSession 里那个 3s 的兜底定时器。
        scheduleSessionDetailsBootstrap(sessionState.sessionId, 150, true);
        if (!hasSessionComposerMetrics()) scheduleSessionStatsBootstrap(sessionState.sessionId, 700, true);
        else settleSessionStatsRequestsIfComplete();
        emit();
        return;
      }
      case 'sent':
        setRunning(true);
        emit();
        return;
      case 'session-title-updated':
      case 'title':
        if (frame.title) sessionState.title = frame.title;
        emit();
        return;
      case 'session-cancelled':
        setRunning(false);
        safeRequest(client.requestSessionStats(sessionState.sessionId));
        safeRequest(client.requestContextUsage(sessionState.sessionId));
        if (contextActive) refreshContextDashboard();
        if (fleetActive) refreshContextFleet();
        emit();
        return;
      case 'session-queues': {
        const queues = frame.queues || {};
        const mine = sessionState.sessionId ? (queues[sessionState.sessionId] || []) : [];
        sessionState.queue = mine;
        refreshTailAfterQueueChange();
        emit();
        return;
      }
      case 'session-queue': {
        if (frame.sessionId === sessionState.sessionId) {
          sessionState.queue = frame.items || [];
          refreshTailAfterQueueChange();
          emit();
        }
        return;
      }
      case 'queue-item-updated':
        return; // 队列内容随后续 session-queue 帧刷新
      case 'commands':
        sessionState.commandGroups = Array.isArray(frame.groups) ? frame.groups : [];
        sessionState.commandLoading = false;
        sessionState.commandError = '';
        emit();
        return;
      case 'command-options':
        sessionState.commandOptionsFor = typeof frame.command === 'string'
          ? frame.command : ((frame.command && frame.command.value) || sessionState.commandOptionsFor);
        sessionState.commandOptions = Array.isArray(frame.options) ? frame.options : [];
        sessionState.commandLoading = false;
        sessionState.commandError = '';
        emit();
        return;
      case 'command-selected':
        sessionState.commandOptions = [];
        sessionState.commandOptionsFor = '';
        sessionState.commandLoading = false;
        if (frame.value && frame.value.provider && frame.value.model) {
          sessionState.selection = Object.assign({}, sessionState.selection || {}, frame.value);
        }
        emit();
        return;
      case 'command-executed':
        sessionState.commandLoading = false;
        emit();
        return;
      case 'tasks':
      case 'tasks-updated': {
        const seq = frame.asOfSeq == null ? null : Number(frame.asOfSeq);
        if (sessionState.tasksAsOfSeq == null || seq == null || seq >= sessionState.tasksAsOfSeq) {
          sessionState.tasks = Array.isArray(frame.todos) ? frame.todos : null;
          sessionState.tasksAsOfSeq = seq;
          emit();
        }
        return;
      }
      case 'goal':
      case 'goal-updated': {
        const seq = frame.asOfSeq == null ? null : Number(frame.asOfSeq);
        if (sessionState.goalAsOfSeq == null || seq == null || seq >= sessionState.goalAsOfSeq) {
          sessionState.goal = frame.goal || null;
          sessionState.goalAsOfSeq = seq;
          sessionState.goalMutation = '';
          emit();
        }
        return;
      }
      case 'goal-edited':
      case 'goal-paused':
      case 'goal-resumed':
      case 'goal-cleared':
        sessionState.goalMutation = '';
        safeRequest(client.requestGoal(sessionState.sessionId));
        emit();
        return;
      case 'session-stats':
        {
          hydrateSessionMetricsFromFrame(frame);
        }
        saveSessionCache(sessionState.sessionId, sessionState.rows);
        emit();
        return;
      case 'context-dashboard': {
        // 上下文面板快照；asOfSeq 用于诊断与旧帧丢弃（只接受不早于当前的值）。
        settleContextRequest();
        const seq = frame.asOfSeq == null ? null : Number(frame.asOfSeq);
        const previous = sessionState.contextDashboard || createContextDashboardState();
        if (previous.asOfSeq != null && seq != null && seq < previous.asOfSeq) return;
        const value = frame.value !== null && typeof frame.value === 'object' ? frame.value : null;
        sessionState.contextDashboard = {
          loading: false, error: null, code: '', unsupported: false,
          asOfSeq: seq, value: value
        };
        rememberContextPanels(sessionState.sessionId);
        emit();
        return;
      }
      case 'context-fleet': {
        // 编队快照：与上下文面板相同的旧帧丢弃规则，值保留到下一次刷新。
        settleFleetRequest();
        const seq = frame.asOfSeq == null ? null : Number(frame.asOfSeq);
        const previous = sessionState.contextFleet || createContextFleetState();
        if (previous.asOfSeq != null && seq != null && seq < previous.asOfSeq) return;
        const value = frame.value !== null && typeof frame.value === 'object' ? frame.value : null;
        sessionState.contextFleet = {
          loading: false, error: null, code: '', unsupported: false,
          asOfSeq: seq, value: value
        };
        rememberContextPanels(sessionState.sessionId);
        emit();
        return;
      }
      case 'context-usage':
        hydrateSessionMetricsFromFrame(frame);
        saveSessionCache(sessionState.sessionId, sessionState.rows);
        emit();
        return;
      case 'permission-options':
        sessionState.permissionOptions = (frame.sessionPermissions && frame.sessionPermissions.options) || null;
        sessionState.permission = (frame.sessionPermissions && frame.sessionPermissions.currentValue) || sessionState.permission;
        emit();
        return;
      case 'permission':
        sessionState.permission = frame.set || sessionState.permission;
        emit();
        return;
      case 'select-model':
        // 主机回执可能只带模型名：与本地选中态合并，避免丢 provider 导致弹窗无法打勾
        if (frame.selected) {
          sessionState.selection = Object.assign({}, sessionState.selection || {}, frame.selected);
          if (frame.selected.provider && frame.selected.model && state.modelCatalog) {
            state.modelCatalog.current = {
              provider: frame.selected.provider,
              model: frame.selected.model
            };
          }
        }
        emit();
        return;
      case 'question-requested': {
        sessionState.pendingQuestion = {
          rpcId: frame.rpcId,
          sessionId: frame.sessionId,
          questions: frame.questions || [],
          replay: frame.replay === true
        };
        sessionState.questionStatus = 'idle';
        emit();
        return;
      }
      case 'question-response':
        sessionState.questionStatus = frame.accepted ? 'accepted' : 'idle';
        if (!frame.accepted && frame.reason) {
          state.notice = { text: frame.reason, isError: true, at: Date.now() };
        }
        emit();
        return;
      case 'question-resolved':
        sessionState.pendingQuestion = null;
        sessionState.questionStatus = 'idle';
        emit();
        return;
      case 'approval-requested': {
        sessionState.pendingApproval = {
          rpcId: frame.rpcId,
          sessionId: frame.sessionId,
          approvalId: frame.approvalId,
          toolName: frame.toolName,
          callId: frame.callId || null,
          reason: frame.reason || null,
          replay: frame.replay === true
        };
        sessionState.approvalStatus = 'idle';
        emit();
        return;
      }
      case 'approval-response':
        sessionState.approvalStatus = frame.accepted ? 'accepted' : 'idle';
        emit();
        return;
      case 'approval-resolved':
        sessionState.pendingApproval = null;
        sessionState.approvalStatus = 'idle';
        emit();
        return;
      case 'assistant-stream':
      case 'session-stream-reset':
        // 流式帧统一由 event/committed 事件投影；这里只处理重置。
        if (frame.kind === 'session-stream-reset' && frame.resetRequired) {
          sessionState.rowsAgg = protocol.newAggregator();
          sessionState.rows = [];
          client.requestHistory(sessionState.sessionId);
          emit();
        }
        return;
      case 'error':
        if (frame.requestType === 'history') finishHistoryPage();
        if (['workspaces', 'sessions', 'host', 'history'].indexOf(frame.requestType) >= 0
          && /Cannot read properties of undefined \(reading ['"]signal['"]\)/.test(String(frame.message || ''))) {
          state.coreCompatibilityError = frame.message;
          state.rpcError = uiText('NAS 端 Mobile Gateway 与 DSH 版本不兼容');
          if (frame.requestType === 'history' && sessionState.sessionId) {
            sessionState.historyError = uiText('NAS 端服务版本不兼容，无法读取会话历史。请升级 Mobile Gateway 与 DSH。');
            sessionState.historyState = 'error:host-version';
          }
          emit();
          return;
        }
        if (['commands', 'command-options', 'command-select', 'command-execute'].indexOf(frame.requestType) >= 0) {
          sessionState.commandLoading = false;
          sessionState.commandError = frame.message || frame.code || uiText('命令请求失败');
          emit();
          return;
        }
        if (String(frame.requestType || '').indexOf('goal-') === 0) {
          sessionState.goalMutation = '';
          safeRequest(client.requestGoal(sessionState.sessionId));
          state.notice = { text: frame.message || uiText('目标操作失败'), isError: true, at: Date.now() };
          emit();
          return;
        }
        // 上下文面板：旧网关回 unknown-command、未安装桥回 context-unavailable，
        // 两种都指引升级网关，不当成普通请求失败弹通知。
        if (frame.requestType === 'context-dashboard') {
          settleContextRequest();
          const code = String(frame.code || '');
          const unsupported = code === 'context-unavailable' || code === 'unknown-command'
            || /unknown message type/i.test(String(frame.message || ''));
          sessionState.contextDashboard = {
            loading: false,
            unsupported: unsupported,
            error: unsupported ? null : (frame.message || code || uiText('上下文数据加载失败')),
            code: code,
            asOfSeq: null,
            value: null
          };
          emit();
          return;
        }
        // 编队面板：与上下文面板相同的升级指引；两者互不影响。
        if (frame.requestType === 'context-fleet') {
          settleFleetRequest();
          const code = String(frame.code || '');
          const unsupported = code === 'context-unavailable' || code === 'unknown-command'
            || /unknown message type/i.test(String(frame.message || ''));
          sessionState.contextFleet = {
            loading: false,
            unsupported: unsupported,
            error: unsupported ? null : (frame.message || code || uiText('编队数据加载失败')),
            code: code,
            asOfSeq: null,
            value: null
          };
          emit();
          return;
        }
        // 历史读取失败：会话页整页错误态（对齐 iOS「历史记录加载失败」）
        if (frame.requestType === 'history' && sessionState.sessionId) {
          sessionState.historyError = frame.message || uiText('Host 无法读取旧格式会话，请修复或升级 Host 后重试。');
          sessionState.historyState = 'error:' + (frame.message || 'history').slice(0, 40);
          emit();
          return;
        }
        state.notice = { text: frame.message || frame.code || uiText('请求失败'), isError: true, at: Date.now() };
        emit();
        return;
      default:
        return;
    }
  }

  // ---------- 自动化任务（对齐 dsh-mobile v1.6.x schedule protocol / iOS AppStore） ----------

  let scheduleCatalogToken = 0;
  let scheduleCatalogTimer = null;
  let scheduleMutation = null; // { requestId, kind, timer }
  let scheduleLoadedOnce = false;
  let scheduleRefreshQueued = false; // catalog 在途时收到 schedule-changed → 到货后补拉

  /** @returns {boolean} 是否消费了该帧 */
  function handleScheduleFrame(frame) {
    if (frame.kind === 'schedule-history' || frame.kind === 'error' && frame.requestType === 'schedule-history') return true;
    // 变更结果（schedule-update / schedule-delete）
    if (scheduleMutation && frame.kind === scheduleMutation.kind &&
        frame.requestId === scheduleMutation.requestId) {
      const succeeded = frame.kind === 'schedule-update'
        ? frame.updated === true
        : frame.deleted === true;
      finishScheduleMutation(succeeded ? null : scheduleFailureMessage(frame.code, frame.message));
      return true;
    }
    if (scheduleMutation && frame.kind === 'error' &&
        frame.requestType === scheduleMutation.kind &&
        (!frame.requestId || frame.requestId === scheduleMutation.requestId)) {
      finishScheduleMutation(scheduleFailureMessage(frame.code, frame.message));
      return true;
    }
    if (frame.kind === 'schedule-catalog') {
      const tasks = (frame.items || [])
        .map(schedule.parseTask)
        .filter(Boolean)
        .sort(function (a, b) {
          if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
          return String(a.scheduledAt) < String(b.scheduledAt) ? -1 : 1;
        });
      state.scheduledTasks = tasks;
      state.scheduledTasksLoading = false;
      state.scheduledTasksError = null;
      scheduleLoadedOnce = true;
      if (scheduleCatalogTimer) {
        clearTimeout(scheduleCatalogTimer);
        scheduleCatalogTimer = null;
      }
      // 在途期间发生过变更：立即补拉一次（对齐 iOS 无条件刷新语义）
      if (scheduleRefreshQueued && state.connection === 'connected') {
        scheduleRefreshQueued = false;
        refreshScheduledTasks();
        return true;
      }
      scheduleRefreshQueued = false;
      emit();
      return true;
    }
    if (frame.kind === 'schedule-changed') {
      if (state.connection === 'connected') {
        if (state.scheduledTasksLoading) scheduleRefreshQueued = true;
        else refreshScheduledTasks();
      }
      return true;
    }
    if (frame.kind === 'error' && frame.requestType === 'schedule-catalog') {
      state.scheduledTasksLoading = false;
      state.scheduledTasksError = frame.message || uiText('自动化任务加载失败');
      emit();
      return true;
    }
    return false;
  }

  /** 拉取自动化任务目录（连接后可调用；页面 onShow / 下拉刷新 / schedule-changed 触发）。 */
  function refreshScheduledTasks() {
    if (state.connection !== 'connected') {
      state.scheduledTasksLoading = false;
      state.scheduledTasksError = uiText('连接网关后可查看自动化任务');
      emit();
      return;
    }
    state.scheduledTasksLoading = true;
    state.scheduledTasksError = null;
    const token = ++scheduleCatalogToken;
    safeRequest(client.requestScheduleCatalog());
    // 12s 兜底超时（对齐 iOS refreshScheduledTasks）
    if (scheduleCatalogTimer) clearTimeout(scheduleCatalogTimer);
    scheduleCatalogTimer = setTimeout(function () {
      scheduleCatalogTimer = null;
      if (token !== scheduleCatalogToken || !state.scheduledTasksLoading) return;
      state.scheduledTasksLoading = false;
      state.scheduledTasksError = uiText('自动化任务请求超时，请重试');
      emit();
    }, 12000);
    emit();
  }

  function scheduleFailureMessage(code, message) {
    switch (code) {
      case 'schedule_conflict': return uiText('任务已被其他设备修改，列表已刷新，请重新打开编辑');
      case 'schedule_ended': return uiText('任务已结束，无法再编辑');
      case 'schedule_not_found': return uiText('任务已不存在，列表已刷新');
      default: return message || uiText('操作失败，请稍后重试');
    }
  }

  function beginScheduleMutation(task, kind) {
    if (state.connection !== 'connected') {
      state.scheduleMutationError = uiText('连接网关后才能修改自动化任务');
      emit();
      return null;
    }
    if (state.scheduledTaskPendingId) return null;
    // 乐观并发：任务记录与列表不一致说明已被修改（对齐 iOS beginScheduledTaskMutation）
    const current = state.scheduledTasks.filter(function (t) {
      return t.id === task.id && t.sessionId === task.sessionId;
    })[0];
    if (!current || JSON.stringify(current.raw) !== JSON.stringify(task.raw)) {
      state.scheduleMutationError = uiText('任务已变化，列表已刷新，请重新操作');
      refreshScheduledTasks();
      emit();
      return null;
    }
    const requestId = util.uuid();
    scheduleMutation = { requestId: requestId, kind: kind, timer: null };
    state.scheduledTaskPendingId = task.id;
    state.scheduleMutationError = null;
    scheduleMutation.timer = setTimeout(function () {
      if (scheduleMutation && scheduleMutation.requestId === requestId) {
        finishScheduleMutation(uiText('操作超时，请刷新任务后重试'));
      }
    }, 15000);
    emit();
    return requestId;
  }

  function finishScheduleMutation(error) {
    if (scheduleMutation && scheduleMutation.timer) {
      clearTimeout(scheduleMutation.timer);
    }
    if (!error && scheduleMutation) {
      state.scheduleCompletedRequestId = scheduleMutation.requestId;
    }
    state.scheduleMutationError = error || null;
    state.scheduledTaskPendingId = null;
    scheduleMutation = null;
    refreshScheduledTasks();
  }

  /** 更新自动化任务：成功返回 requestId，失败返回 null（错误在 state.scheduleMutationError）。 */
  function updateScheduledTask(task, title, prompt, change) {
    const requestId = beginScheduleMutation(task, 'schedule-update');
    if (requestId === null) return null;
    client.sendScheduleUpdate(
      task.sessionId, task.id, task.raw,
      String(title || '').trim(), String(prompt || '').trim(),
      change || null, requestId
    );
    return requestId;
  }

  /** 删除自动化任务及其投递记录：成功返回 requestId。 */
  function deleteScheduledTask(task) {
    const requestId = beginScheduleMutation(task, 'schedule-delete');
    if (requestId === null) return null;
    client.sendScheduleDelete(task.sessionId, task.id, requestId);
    return requestId;
  }

  // ---------- 插件管理（对齐 dsh-mobile v1.7.x plugin protocol / iOS AppStore） ----------

  let pluginCatalogToken = null;
  let pluginCatalogTimer = null;
  let pluginToggleToken = null;
  let pluginToggleTimer = null;
  let pluginPageVisited = false;

  /** 插件管理错误 → 用户可读文案（对齐 iOS 语义，补充网关侧版本/配对提示）。 */
  function pluginFailureMessage(frame) {
    const code = frame && frame.code;
    const message = (frame && frame.message) || '';
    if (code === 'authentication-required') {
      return uiText('插件管理需要已配对设备：请按中继部署文档重新扫码配对一次（网关会保存凭据）');
    }
    if (message.indexOf('unknown message type') === 0) {
      return uiText('当前网关插件版本不支持插件管理，请升级 dsh-plugin-mobile-gateway 后重试');
    }
    return message || uiText('插件目录加载失败');
  }

  /** @returns {boolean} 是否消费了该帧 */
  function handlePluginFrame(frame) {
    if (pluginInstaller.handle(frame)) return true;
    // Marketplace failures belong to Discover, never the installed-plugin catalog.
    if (typeof frame.kind === 'string' && frame.kind.indexOf('plugin-market-') === 0 ||
        frame.kind === 'error' && (typeof frame.requestType === 'string' && frame.requestType.indexOf('plugin-market-') === 0 ||
          typeof frame.message === 'string' && frame.message.indexOf('unknown message type: plugin-market-') === 0)) return true;
    if (frame.kind === 'plugin-catalog' &&
        (!frame.requestId || frame.requestId === pluginCatalogToken)) {
      state.pluginCatalog = pluginsLib.buildCatalog(frame);
      state.pluginsLoading = false;
      state.pluginsError = frame.managementAvailable === true ? null : uiText('当前 Host 不支持插件管理');
      if (pluginCatalogTimer) {
        clearTimeout(pluginCatalogTimer);
        pluginCatalogTimer = null;
      }
      emit();
      return true;
    }
    if (frame.kind === 'plugins-changed') {
      if (pluginPageVisited && state.connection === 'connected') refreshPlugins();
      return true;
    }
    if ((frame.kind === 'plugin-bundle-set-enabled' || frame.kind === 'plugin-entry-set-enabled') &&
        (!frame.requestId || frame.requestId === pluginToggleToken)) {
      const application = frame.result && frame.result.application;
      switch (application) {
        case 'applied': state.pluginNotice = null; break;
        case 'restart-required': state.pluginNotice = uiText('设置已保存，请重启 DSH Web 后刷新目录'); break;
        case 'overridden': state.pluginNotice = uiText('插件状态被其他配置覆盖，请检查 Host 配置'); break;
        default: state.pluginNotice = (frame.result && frame.result.error) || uiText('插件操作未生效');
      }
      finishPluginToggle();
      return true;
    }
    // 插件相关错误帧：requestType 或 requestId 任一匹配即可
    const isPluginError = frame.kind === 'error' && (
      frame.requestType === 'plugin-catalog' ||
      frame.requestType === 'plugin-bundle-set-enabled' ||
      frame.requestType === 'plugin-entry-set-enabled' ||
      (frame.requestId && frame.requestId === pluginCatalogToken) ||
      (frame.requestId && frame.requestId === pluginToggleToken) ||
      (typeof frame.message === 'string' && frame.message.indexOf('unknown message type: plugin-') === 0)
    );
    if (isPluginError) {
      console.warn(uiText('[plugins] 网关错误帧'), JSON.stringify(frame));
      const isToggle = frame.requestType === 'plugin-bundle-set-enabled' ||
        frame.requestType === 'plugin-entry-set-enabled' ||
        (frame.requestId && frame.requestId === pluginToggleToken);
      if (isToggle) {
        state.pluginNotice = pluginFailureMessage(frame);
        finishPluginToggle();
      } else {
        state.pluginsLoading = false;
        state.pluginsError = pluginFailureMessage(frame);
        if (pluginCatalogTimer) {
          clearTimeout(pluginCatalogTimer);
          pluginCatalogTimer = null;
        }
        emit();
      }
      return true;
    }
    return false;
  }

  function finishPluginToggle() {
    if (pluginToggleTimer) {
      clearTimeout(pluginToggleTimer);
      pluginToggleTimer = null;
    }
    pluginToggleToken = null;
    state.pluginPendingName = null;
    refreshPlugins();
  }

  /**
   * 选择模型：本地乐观更新选中态（弹窗打勾与输入栏标签立即同步），
   * 主机回执到达后以回执为准；失败则回滚。
   */
  function selectModel(sessionId, provider, model, reasoningEffort) {
    if (!provider || !model) return Promise.reject(new Error(uiText('缺少模型信息')));
    const previous = sessionState.selection;
    const previousCatalogCurrent = state.modelCatalog ? state.modelCatalog.current : null;
    const next = { provider: provider, model: model };
    if (reasoningEffort) next.reasoningEffort = reasoningEffort;
    else if (previous && previous.provider === provider && previous.model === model && previous.reasoningEffort) {
      next.reasoningEffort = previous.reasoningEffort;
    }
    sessionState.selection = next;
    if (state.modelCatalog) state.modelCatalog.current = { provider: provider, model: model };
    emit();
    return client.selectModel(sessionId, provider, model, reasoningEffort).catch(function (err) {
      sessionState.selection = previous;
      if (state.modelCatalog) state.modelCatalog.current = previousCatalogCurrent;
      emit();
      throw err;
    });
  }

  /** 拉取插件目录（页面 onShow / 下拉刷新 / plugins-changed 触发）。 */  function refreshPlugins() {
    pluginPageVisited = true;
    if (state.connection !== 'connected') {
      state.pluginsLoading = false;
      state.pluginsError = uiText('连接网关后可查看插件');
      emit();
      return;
    }
    pluginCatalogToken = util.uuid();
    state.pluginsLoading = true;
    state.pluginsError = null;
    const sent = client.sendPluginCatalog(pluginCatalogToken);
    if (!sent) {
      // 发送失败（socket 已死）：不等 12 秒超时，直接给出可读错误
      pluginCatalogToken = null;
      state.pluginsLoading = false;
      state.pluginsError = uiText('连接网关后可查看插件');
      emit();
      return;
    }
    // 12s 兜底超时（对齐 iOS refreshPlugins）
    if (pluginCatalogTimer) clearTimeout(pluginCatalogTimer);
    pluginCatalogTimer = setTimeout(function () {
      pluginCatalogTimer = null;
      if (!state.pluginsLoading) return;
      console.warn(uiText('[plugins] 目录请求超时（网关无响应），lastKind=plugin-catalog'));
      state.pluginsLoading = false;
      state.pluginsError = uiText('插件目录请求超时，请重试');
      emit();
    }, 12000);
    emit();
  }

  /** 启用/停用插件 bundle 或其单个组件条目（entryId 优先）。 */
  function setPluginEnabled(name, enabled, entryId) {
    if (state.connection !== 'connected' ||
        (state.pluginInstall && ['installing', 'cancelling', 'applying', 'unconfirmed'].includes(state.pluginInstall.phase)) ||
        !state.pluginCatalog || state.pluginCatalog.managementAvailable !== true ||
        pluginToggleToken !== null) {
      return false;
    }
    const bundle = state.pluginCatalog.bundles.find(b => b.name === name);
    if (enabled && !entryId && bundle && bundle.availability === 'missing') {
      state.pluginNotice = uiText('此插件尚未安装，请先按主机提供的版本安装后启用');
      emit();
      return false;
    }
    const requestId = util.uuid();
    pluginToggleToken = requestId;
    state.pluginPendingName = name;
    state.pluginNotice = null;
    if (entryId) client.sendPluginEntrySetEnabled(requestId, entryId, enabled);
    else client.sendPluginBundleSetEnabled(requestId, name, enabled);
    // 15s 兜底超时（对齐 iOS setPluginEnabled）
    pluginToggleTimer = setTimeout(function () {
      if (pluginToggleToken !== requestId) return;
      pluginToggleToken = null;
      state.pluginPendingName = null;
      state.pluginNotice = uiText('操作结果待确认，请刷新插件目录');
      refreshPlugins();
    }, 15000);
    emit();
    return true;
  }

  function ingestEvents(rawEvents, prepend) {
    if (sessionState.collaboration.sessionId !== sessionState.sessionId) sessionState.collaboration = collaboration.create(sessionState.sessionId);
    collaboration.ingest(sessionState.collaboration, rawEvents);
    promoteCachedRows();
    if (!sessionState.rowsAgg) sessionState.rowsAgg = protocol.newAggregator();
    const sessionId = sessionState.sessionId;
    const sorted = rawEvents.slice().sort(function (a, b) { return a.seq - b.seq; });
    if (prepend && sessionState.rowsAgg.rows.length && rawBuffer.length) {
      // 归一化指纹判重：live 帧与 history 页形状不同，按原始 JSON 比会把已收到的事件
      const changed = sorted.filter(function (event) {
        const known = rawFingerprints.get(event.seq);
        return known === undefined || known !== fingerprintOf(event);
      });
      if (!changed.length) return;
      // A fresh latest page often only extends the live tail. Do not replay the whole session.
      if (changed.every(event => event.seq > rawBuffer[rawBuffer.length - 1].seq)) {
        ingestEvents(changed, false);
        return;
      }
    }
    if (prepend) {
      // 真正的旧页/修订需要重放，以保持跨页工具、回合与结算关系正确。
      try {
        rebuildWithMore(sorted);
      } catch (e) {
        // 旧版 Host 的事件形态解析失败：跳过坏事件而不是丢弃整批历史
        sessionState.ingestErrors = (sessionState.ingestErrors || 0) + 1;
      }
      sessionState.rows = sessionState.rowsAgg.rows.slice();
      refreshTurnUsage(rawBuffer);
      return;
    }
    let bad = 0;
    sorted.forEach(function (raw) {
      try {
        if (rawSeqs.has(raw.seq)) return;
        const normalized = protocol.normalizeRawEvent(raw, sessionId);
        protocol.applyEvent(sessionState.rowsAgg, normalized);
      } catch (e) {
        // 老格式/未知形态：计数并跳过，绝不让单条事件炸掉整批历史
        bad += 1;
      }
    });
    if (bad) sessionState.ingestErrors = (sessionState.ingestErrors || 0) + bad;
    try {
      sessionState.rows = sessionState.rowsAgg.rows.slice();
      allRawEvents(sorted, true);
      refreshTurnUsage(sorted);
      invalidateTrajectory();
      rebuildRunCues();
    } catch (e) {
      sessionState.ingestErrors = (sessionState.ingestErrors || 0) + 1;
      sessionState.rows = sessionState.rowsAgg.rows.slice();
    }
  }

  // 每轮精确用量（移植 DSH deriveTurnTokenUsage）：仅在回合边界或重放时重算
  function refreshTurnUsage(batch) {
    try {
      const events = Array.isArray(batch) ? batch : [];
      const boundary = events.some((event) => event && (event.type === 'turn/end' || event.type === 'turn/start'));
      if (!boundary && sessionState.turnUsage) return;
      sessionState.turnUsage = turnUsage.deriveAll(rawBuffer);
    } catch (e) {
      sessionState.turnUsage = sessionState.turnUsage || {};
    }
  }

  // 保留原始事件缓冲以重建轨迹
  let rawBuffer = [];
  let rawSeqs = new Set();          // seq 索引：追加去重 O(1)，避免整表 some() 扫描
  // 同一事件有两种序列化形状（live 帧扁平 text vs history 页 content blocks），按原始
  let rawFingerprints = new Map();  // seq -> 归一化指纹
  function sessionResumeCursor() {
    let latest = -1;
    for (let i = 0; i < rawBuffer.length; i += 1) {
      const seq = rawBuffer[i] && rawBuffer[i].seq;
      if (Number.isSafeInteger(seq) && seq > latest) latest = seq;
    }
    return latest >= 0 ? latest : undefined;
  }
  function fingerprintOf(raw) {
    try {
      // 只取语义事件体：外层 time/dateMs 时钟不同，内层 raw 是原始透传，都会因形状误判。
      const clone = Object.assign({}, protocol.normalizeRawEvent(raw, sessionState.sessionId).event);
      delete clone.raw;
      return JSON.stringify(clone);
    } catch (e) {
      return 'raw:' + JSON.stringify(raw);
    }
  }
  /** 统一替换缓冲：rawBuffer / rawSeqs / rawFingerprints 三者必须同步。 */
  function setRawBuffer(events) {
    rawBuffer = events;
    rawSeqs = new Set(events.map(function (e) { return e.seq; }));
    rawFingerprints = new Map();
    events.forEach(function (e) { rawFingerprints.set(e.seq, fingerprintOf(e)); });
  }
  /** 追加新事件（调用方保证 seq 未出现过）。 */
  function appendRawBuffer(events) {
    if (!events.length) return;
    events.forEach(function (e) {
      rawSeqs.add(e.seq);
      rawFingerprints.set(e.seq, fingerprintOf(e));
    });
    rawBuffer = rawBuffer.concat(events);
    rawBuffer.sort(function (a, b) { return a.seq - b.seq; });
  }
  let trajectoryActive = false;
  let trajectoryDirty = true;
  let trajectoryRefreshTimer = null;
  const TRAJECTORY_REFRESH_DELAY_MS = 32;
  function invalidateTrajectory() {
    trajectoryDirty = true;
    if (!trajectoryActive || trajectoryRefreshTimer) return;
    trajectoryRefreshTimer = setTimeout(function () {
      trajectoryRefreshTimer = null;
      if (trajectoryActive) refreshTrajectory();
    }, TRAJECTORY_REFRESH_DELAY_MS);
  }
  function refreshTrajectory() {
    if (trajectoryRefreshTimer) clearTimeout(trajectoryRefreshTimer);
    trajectoryRefreshTimer = null;
    if (!trajectoryDirty) return;
    sessionState.trajectory = protocol.buildTrajectory(rawBuffer, sessionState.sessionId);
    trajectoryDirty = false;
  }
  function allRawEvents(latest, append) {
    if (append) {
      const fresh = latest.filter(function (e) { return !rawSeqs.has(e.seq); });
      appendRawBuffer(fresh);
    }
    return rawBuffer;
  }

  /**
   * 运行指示条活动线索（对齐 dsh-mobile DeepSearchProgressRow 的 phrase cue）：
   * 起始时间 = 最近一条用户消息时间；线索 = 该消息之后的事件流，按时间顺序。
   * 活动映射：context→gathering、reasoning→thinking/revisiting、
   * tool→exploring、toolResult→reviewing（错误→revisiting）、
   * assistant→composing、status→working。
   */
  let runCueWatermark = -1;         // 已提取线索的最大 seq：增量提取，避免每条事件全量重扫
  function rebuildRunCues(full) {
    if (full) runCueWatermark = -1;
    let startMs = runCueWatermark === -1 ? null : sessionState.runStartMs;
    const cues = runCueWatermark === -1 ? [] : (sessionState.runCues || []);
    for (let i = 0; i < rawBuffer.length; i += 1) {
      const raw = rawBuffer[i];
      const type = raw && raw.type;
      if (!type || raw.seq <= runCueWatermark) continue;
      runCueWatermark = raw.seq;
      const at = util.eventDateMs(raw.time);
      if (type === 'user/message') {
        // 新一轮：重置起始时间与线索
        startMs = at;
        cues.length = 0;
        continue;
      }
      if (startMs == null) continue;
      if (type.indexOf('context') === 0) cues.push({ activity: 'gathering', at: at });
      else if (type.indexOf('reasoning') === 0) cues.push({ activity: 'reasoning', at: at });
      else if (type === 'tool/call' || type.indexOf('tool/code-dispatch-start') === 0 || type === 'tool/code-dispatch') {
        cues.push({ activity: 'exploring', at: at });
      } else if (type === 'tool/result' || type === 'tool/code-dispatch-result') {
        const isError = !!(raw.data && (raw.data.error !== undefined && raw.data.error !== null && raw.data.error !== false || raw.data.isError === true));
        cues.push({ activity: isError ? 'revisiting' : 'reviewing', at: at });
      } else if (type.indexOf('assistant/') === 0) cues.push({ activity: 'composing', at: at });
      else if (type === 'status' || type.indexOf('command/') === 0 || type.indexOf('compaction/') === 0) {
        cues.push({ activity: 'working', at: at });
      }
    }
    sessionState.runStartMs = startMs;
    sessionState.runCues = cues;
  }

  function rebuildWithMore(older) {
    const merged = {};
    rawBuffer.forEach(function (e) { merged[e.seq] = e; });
    older.forEach(function (e) { merged[e.seq] = e; });
    setRawBuffer(Object.keys(merged).map(function (k) { return merged[k]; })
      .sort(function (a, b) { return a.seq - b.seq; }));
    sessionState.rowsAgg = protocol.newAggregator();
    rawBuffer.forEach(function (raw) {
      protocol.applyEvent(sessionState.rowsAgg, protocol.normalizeRawEvent(raw, sessionState.sessionId));
    });
    sessionState.rows = sessionState.rowsAgg.rows.slice();
    // 页面据此把“历史页插入”与普通更新区分开，用滚动锚点保持当前阅读位置。
    sessionState.historyMergeId = (sessionState.historyMergeId || 0) + 1;
    invalidateTrajectory();
    rebuildRunCues(true);
    replayLiveAttempt();
  }

  let statsTimer = null;
  let historyRetryTimer = null;
  let olderHistoryTimeout = null;
  let olderHistoryPending = null;
  // 桌面端发消息时队列帧先到、user/message 事件可能稍晚，这里补拉一次 history 尾部。
  let queueTailRefreshTimer = null;
  let queueTailRefreshAt = 0;
  const QUEUE_TAIL_REFRESH_GAP_MS = 1500;
  const QUEUE_TAIL_REFRESH_DELAY_MS = 400;
  const LIVE_STREAM_FRESH_MS = 2000;
  function refreshTailAfterQueueChange() {
    const now = Date.now();
    if (now - queueTailRefreshAt < QUEUE_TAIL_REFRESH_GAP_MS) return;
    queueTailRefreshAt = now;
    if (queueTailRefreshTimer) return;
    queueTailRefreshTimer = setTimeout(function () {
      queueTailRefreshTimer = null;
      // 运行中已有实时事件流；此时补拉历史会重放/重建 rows，打断正在流式显示的过程。
      if (state.connection !== 'connected' || !sessionState.sessionId) return;
      if (sessionState.historyState === 'requested' || sessionState.running === true) return;
      // 实时帧刚刚到过：说明订阅是通的，等事件自己到达即可。
      if (now - (sessionState.lastEventAt || 0) < LIVE_STREAM_FRESH_MS) return;
      client.requestHistory(sessionState.sessionId);
    }, QUEUE_TAIL_REFRESH_DELAY_MS);
  }

  function finishHistoryPage() {
    if (olderHistoryTimeout) clearTimeout(olderHistoryTimeout);
    olderHistoryTimeout = null; olderHistoryPending = null;
    sessionState.historyPaging = false;
  }

  function resetHistoryPaging() {
    finishHistoryPage();
  }

  function failOlderHistory(pending) {
    if (olderHistoryPending !== pending) return;
    finishHistoryPage();
    if (pending.id !== sessionState.sessionId || pending.generation !== client.connectGeneration) return;
    sessionState.historyError = uiText('记录同步暂时中断，请重试');
    emit();
  }

  function armOlderHistoryTimeout(pending) {
    if (olderHistoryTimeout) clearTimeout(olderHistoryTimeout);
    olderHistoryTimeout = setTimeout(() => {
      if (olderHistoryPending !== pending) return;
      failOlderHistory(pending);
    }, 8000);
  }

  function retryOlderHistoryWithLargerBudget(pending) {
    const maxBytes = 2 * 1024 * 1024;
    if (!client.relayMeta || pending.maxBytes >= maxBytes) return false;
    pending.maxBytes = Math.min(maxBytes, pending.maxBytes * 2);
    if (client.requestHistory(pending.id, pending.cursor, sessionState.historyFormatVersion, pending.maxBytes) === false) return false;
    armOlderHistoryTimeout(pending);
    return true;
  }

  function requestOlderHistory() {
    const id = sessionState.sessionId, cursor = sessionState.nextBeforeSeq;
    if (!id || !sessionState.hasMoreHistory || olderHistoryPending) return false;
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !sessionState.historyFormatVersion) {
      sessionState.historyError = uiText('网关未提供有效历史游标，请更新网关后重试');
      emit(); return false;
    }
    const cachedPage = historyPageCache.get(historyPageKey(id, cursor, sessionState.historyFormatVersion), value =>
      value && value.sessionId === id && value.beforeSeq === cursor &&
        value.historyFormatVersion === sessionState.historyFormatVersion && Array.isArray(value.events)
        ? value : null);
    if (cachedPage) {
      olderHistoryPending = { id, cursor, generation: client.connectGeneration, cached: true };
      sessionState.historyError = '';
      sessionState.historyPaging = true;
      if (!sessionState.rows.length) sessionState.historyState = 'requested';
      handleSessionFrame({ kind: 'history', sessionId: id, events: cachedPage.events,
        hasMore: cachedPage.hasMore, nextBeforeSeq: cachedPage.nextBeforeSeq,
        historyFormatVersion: cachedPage.historyFormatVersion, beforeSeqPlaceholder: true,
        cachedLocal: true });
      return true;
    }
    if (state.connection !== 'connected') return false;
    sessionState.historyError = '';
    const pending = { id, cursor, generation: client.connectGeneration,
      maxBytes: client.relayMeta ? 256 * 1024 : 2 * 1024 * 1024 };
    sessionState.historyLastPageBytes = 0;
    olderHistoryPending = pending;
    sessionState.historyPaging = true;
    if (!sessionState.rows.length) sessionState.historyState = 'requested';
    const sent = client.requestHistory(id, cursor, sessionState.historyFormatVersion);
    if (sent === false) { failOlderHistory(pending); return false; }
    // 8s 兜底：旧页超时要尽快露出"重试"，让用户能手动再拉一次。
    armOlderHistoryTimeout(pending);
    emit();
    return true;
  }

  let dataWatchdogTimer = null;
  function refreshStatsSoon() {
    if (statsTimer) return;
    statsTimer = setTimeout(function () {
      statsTimer = null;
      if (sessionState.sessionId) {
        safeRequest(client.requestSessionStats(sessionState.sessionId));
        safeRequest(client.requestContextUsage(sessionState.sessionId));
        // 上下文/编队面板只在可见时随回合结束刷新（turn/end 后 800ms 已收敛为非运行态），
        if (contextActive && !sessionState.running) refreshContextDashboard();
        if (fleetActive && !sessionState.running) refreshContextFleet();
      }
    }, 800);
  }

  /**
   * 请求上下文面板快照；保留旧值以便刷新期间不闪空。
   * @param {boolean} [force] 手动刷新/切入分段时强制发一次（自动轮询不加塞）
   */
  function refreshContextDashboard(force) {
    if (!sessionState.sessionId || state.connection !== 'connected') return false;
    // 上一帧还没回来：自动轮询跳过这一拍，避免请求叠加；手动刷新仍允许。
    if (contextRequestPending && force !== true) return false;
    const previous = sessionState.contextDashboard || createContextDashboardState();
    sessionState.contextDashboard = Object.assign({}, previous, { loading: true, error: null });
    contextRequestPending = true;
    if (contextRequestTimer) clearTimeout(contextRequestTimer);
    contextRequestTimer = setTimeout(settleContextRequest, CONTEXT_REQUEST_TIMEOUT_MS);
    emit();
    safeRequest(client.requestContextDashboard(sessionState.sessionId));
    return true;
  }

  /** 请求编队面板快照；保留旧值以便刷新期间不闪空（force 语义同上）。 */
  function refreshContextFleet(force) {
    if (!sessionState.sessionId || state.connection !== 'connected') return false;
    if (fleetRequestPending && force !== true) return false;
    const previous = sessionState.contextFleet || createContextFleetState();
    sessionState.contextFleet = Object.assign({}, previous, { loading: true, error: null });
    fleetRequestPending = true;
    if (fleetRequestTimer) clearTimeout(fleetRequestTimer);
    fleetRequestTimer = setTimeout(settleFleetRequest, CONTEXT_REQUEST_TIMEOUT_MS);
    emit();
    safeRequest(client.requestContextFleet(sessionState.sessionId));
    return true;
  }

  // ---------- v2 运行中自动刷新（2.5s；上一帧未返回不叠加） ----------

  function settleContextRequest() {
    contextRequestPending = false;
    if (contextRequestTimer) { clearTimeout(contextRequestTimer); contextRequestTimer = null; }
  }

  function settleFleetRequest() {
    fleetRequestPending = false;
    if (fleetRequestTimer) { clearTimeout(fleetRequestTimer); fleetRequestTimer = null; }
  }

  function contextPollingWanted() {
    return contextActive === true && sessionState.running === true && state.connection === 'connected' && !!sessionState.sessionId;
  }

  function fleetPollingWanted() {
    return fleetActive === true && sessionState.running === true && state.connection === 'connected' && !!sessionState.sessionId;
  }

  function stopContextPoll() { if (contextPollTimer) { clearTimeout(contextPollTimer); contextPollTimer = null; } }
  function stopFleetPoll() { if (fleetPollTimer) { clearTimeout(fleetPollTimer); fleetPollTimer = null; } }

  /** 停自动刷新并释放 in-flight 标记（断链/切会话时）。 */
  function stopContextPolling() {
    stopContextPoll(); stopFleetPoll(); settleContextRequest(); settleFleetRequest();
  }

  function scheduleContextPoll() {
    if (contextPollTimer || !contextPollingWanted()) return;
    contextPollTimer = setTimeout(function () {
      contextPollTimer = null;
      if (!contextPollingWanted()) return;
      refreshContextDashboard();
      scheduleContextPoll();
    }, CONTEXT_POLL_MS);
  }

  function scheduleFleetPoll() {
    if (fleetPollTimer || !fleetPollingWanted()) return;
    fleetPollTimer = setTimeout(function () {
      fleetPollTimer = null;
      if (!fleetPollingWanted()) return;
      refreshContextFleet();
      scheduleFleetPoll();
    }, CONTEXT_POLL_MS);
  }

  function syncContextPolling() { if (contextPollingWanted()) scheduleContextPoll(); else stopContextPoll(); }
  function syncFleetPolling() { if (fleetPollingWanted()) scheduleFleetPoll(); else stopFleetPoll(); }

  // 「刚完成」标记：会话从运行中变成结束时记下完成时刻，首页绿点只在 24h 内显示，
  const COMPLETED_KEY = 'dsh_session_completed';
  const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
  let completedAtMap = null;
  function loadCompletedAt() {
    if (completedAtMap) return completedAtMap;
    completedAtMap = {};
    try {
      const raw = wx.getStorageSync(COMPLETED_KEY);
      if (raw && typeof raw === 'object') {
        const now = Date.now();
        Object.keys(raw).forEach((id) => {
          const at = Number(raw[id]) || 0;
          if (at > 0 && now - at <= COMPLETED_TTL_MS) completedAtMap[id] = at;
        });
      }
    } catch (_) { completedAtMap = {}; }
    return completedAtMap;
  }
  /** 点进会话就算看过了：清掉「刚完成」标记，首页绿点立刻回落成默认灰点。 */
  function clearCompleted(sessionId) {
    const id = String(sessionId || '');
    if (!id) return;
    const map = loadCompletedAt();
    if (!map[id]) {
      // 内存里可能还挂着，一并清掉（比如从缓存恢复但未落盘）
      const row = (state.sessions || []).find((item) => item && item.sessionId === id);
      if (row && row.completedAt) row.completedAt = 0;
      return;
    }
    delete map[id];
    try { wx.setStorageSync(COMPLETED_KEY, map); } catch (_) { /* 存储失败不影响进入会话 */ }
    const row = (state.sessions || []).find((item) => item && item.sessionId === id);
    if (row) { row.completedAt = 0; row.viewedAt = Date.now(); }
  }

  function attachCompletedAt(list) {
    const map = loadCompletedAt();
    (list || []).forEach((item) => {
      if (item && item.sessionId && map[item.sessionId]) item.completedAt = map[item.sessionId];
    });
    return list;
  }
  function rememberCompleted(prevList, nextList) {
    const map = loadCompletedAt();
    const prevById = Object.create(null);
    (prevList || []).forEach((item) => { if (item && item.sessionId) prevById[item.sessionId] = item; });
    let changed = false;
    (nextList || []).forEach((item) => {
      if (!item || !item.sessionId) return;
      const prev = prevById[item.sessionId];
      if (prev && prev.running === true && item.running !== true) {
        map[item.sessionId] = Date.now();
        changed = true;
      }
    });
    if (!changed) return map;
    const now = Date.now();
    Object.keys(map).forEach((id) => { if (now - map[id] > COMPLETED_TTL_MS) delete map[id]; });
    try { wx.setStorageSync(COMPLETED_KEY, map); } catch (_) { /* 存储失败不影响列表 */ }
    return map;
  }

  function mapSessionSummary(item) {
    const source = item || {};
    const projections = source.projections || {};
    const values = projections.values || {};
    const sessionId = source.sessionId || source.session_id || source.id || source.key || '';
    const title = values.title || source.title || source.name || source.displayName || source.display_title || null;
    const updated = source.updatedAt || source.updated_at || source.lastActivityAt || source.last_activity_at || source.createdAt || source.created_at;
    const hasConversation = source.hasConversation !== undefined
      ? source.hasConversation
      : source.has_conversation;
    return {
      sessionId: sessionId,
      updatedAt: updated ? util.eventDateMs(updated) : Date.now(),
      running: source.running === true || source.status === 'running',
      runningKnown: typeof source.running === 'boolean' || typeof source.status === 'string',
      hasUnread: source.hasUnread === true || source.has_unread === true,
      completedAt: 0,
      // 网关侧记录的「最近被订阅/读取」时刻：电脑端点进会话也会更新它。
      lastOpenedAt: typeof source.lastOpenedAt === 'number' && isFinite(source.lastOpenedAt) ? source.lastOpenedAt : 0,
      // 本机打开过的时间戳（openSession 时写入，立即置灰，不用等下一帧列表）。
      viewedAt: 0,
      blank: source.blank === true,
      cwd: source.cwd || source.workingDirectory || source.working_directory || null,
      agentPreset: typeof values.agentPreset === 'string' ? values.agentPreset
        : (typeof source.agentPreset === 'string' ? source.agentPreset
          : (typeof source.agent_preset === 'string' ? source.agent_preset : null)),
      agentPresetAsOfSeq: projections.asOfSeq != null && Number.isSafeInteger(Number(projections.asOfSeq))
        ? Number(projections.asOfSeq) : null,
      displayTitle: source.displayTitle || source.display_title || source.label || null,
      hasConversation: hasConversation,
      title: title,
      // 子代理（subagent/child）会话与工作区归属：用于快捷切换时过滤
      parentSessionId: source.parentSessionId || source.parent_session_id || source.parentId || source.parent_id || null,
      kind: source.kind || source.type || null,
      workspaceId: source.workspaceId || source.workspace_id || null
    };
  }

  // ---------- 默认值（按主机档案命名空间） ----------

  function saveDefaults(value) {
    try {
      if (state.activeID) wx.setStorageSync('dsh_defaults.' + state.activeID, value);
      else wx.setStorageSync(STORAGE_KEYS.defaults, value);
    } catch (e) { /* 存储失败不阻断 */ }
  }

  function loadDefaults() {
    try {
      if (state.activeID) {
        const scoped = wx.getStorageSync('dsh_defaults.' + state.activeID);
        if (scoped) return scoped;
      }
      return wx.getStorageSync(STORAGE_KEYS.defaults) || null;
    } catch (e) {
      return null;
    }
  }

  function rememberTrustedEndpoint(endpoint) {
    try {
      const list = wx.getStorageSync(STORAGE_KEYS.trustedEndpoints) || [];
      if (list.indexOf(endpoint) < 0) {
        list.push(endpoint);
        wx.setStorageSync(STORAGE_KEYS.trustedEndpoints, list);
      }
    } catch (e) { /* 忽略 */ }
  }

  function isTrustedEndpoint(endpoint) {
    try {
      const list = wx.getStorageSync(STORAGE_KEYS.trustedEndpoints) || [];
      return list.length === 0 || list.indexOf(endpoint) >= 0;
    } catch (e) {
      return true;
    }
  }

  // ---------- 主机档案（MultiGatewayStore 对齐） ----------

  let pendingProfile = null; // 配对进行中的临时档案（paired/hello 提交入库）
  let pendingPairing = false;

  function hostLabelFromEndpoint(endpoint) {
    const m = /^(?:ws|wss):\/\/([^/:?#]+)/i.exec(String(endpoint || ''));
    return m ? m[1] : '';
  }

  function getProfile(id) {
    for (let i = 0; i < state.profiles.length; i += 1) {
      if (state.profiles[i].id === id) return state.profiles[i];
    }
    return null;
  }

  function upsertProfile(profile) {
    let index = -1;
    for (let i = 0; i < state.profiles.length; i += 1) {
      if (state.profiles[i].id === profile.id) { index = i; break; }
    }
    if (index >= 0) state.profiles[index] = profile;
    else state.profiles.push(profile);
    hosts.saveProfiles(state.profiles);
  }

  /** paired/hello 帧接受网关身份（iOS acceptIdentity 对齐）。 */
  function acceptIdentity(frame) {
    const isPending = !!pendingProfile;
    let profile = isPending ? pendingProfile : getProfile(state.activeID);
    const frameGatewayId = frame.gatewayId ? String(frame.gatewayId).toLowerCase() : null;
    if (frameGatewayId && !(profile && profile.relay)) {
      // 网关身份已有归属档案（如配对载荷缺 gatewayId）：并入原档案。
      for (let i = 0; i < state.profiles.length; i += 1) {
        const p = state.profiles[i];
        if (p.gatewayId === frameGatewayId && (!profile || p.id !== profile.id)) {
          profile = p;
          break;
        }
      }
    }
    if (!profile) {
      profile = hosts.newProfile({
        gatewayName: frame.gatewayName || hostLabelFromEndpoint(state.endpoint) || uiText('新主机'),
        endpoints: state.endpoint ? [state.endpoint] : [],
        preferredEndpoint: state.endpoint
      });
    }
    // relay 的 nodeId 用于路由和 E2EE 验签，不能被网关自身 UUID 覆盖。
    if (frameGatewayId && !profile.relay) profile.gatewayId = frameGatewayId;
    const name = String(frame.gatewayName || '').trim();
    if (name) profile.gatewayName = frame.gatewayName;
    // 老档案没有设备来源：连上后用最新网关名重新推断一次（默认电脑），并随档案落盘。
    if (profile.deviceKindSource !== 'user' && profile.deviceKindSource !== 'payload') {
      const derived = hosts.deriveDeviceKind({ gatewayName: profile.gatewayName });
      profile.deviceKind = derived.kind;
      profile.deviceKindSource = 'auto';
    }
    if (frame.device && frame.device.id) profile.remoteDeviceId = frame.device.id;
    if (client.lastToken && state.endpoint) {
      hosts.saveCredential(profile.id, state.endpoint, client.lastToken);
      rememberTrustedEndpoint(state.endpoint);
    }
    if (frame.kind !== 'hello') {
      // paired 帧只暂存身份；hello 帧提交入库（与 iOS 一致）。
      if (isPending) pendingProfile = profile;
      else upsertProfile(profile);
      emit();
      return;
    }
    profile.lastConnectedAt = Date.now();
    if (state.endpoint) profile.preferredEndpoint = state.endpoint;
    // 记住连通时的网络族：下次网络族变了才让局域网插队/整族跳过，同族内不折腾。
    const connectedFamily = routeTable.networkFamily(cachedNetworkType);
    if (connectedFamily) profile.preferredNetwork = connectedFamily;
    upsertProfile(profile);
    if (isPending || state.activeID !== profile.id) {
      state.activeID = profile.id;
      hosts.setActiveID(profile.id);
    }
    pendingProfile = null;
    pendingPairing = false;
    emit();
  }

  // ---------- 全网络自动选路 ----------
  // 候选顺序（route-table.allowedFamilies）：
  //   微信小程序：首选 → 托管中继（小程序的公网）→ 局域网；不碰运营者自己的公网直连
  //               地址（Cloudflare/反代基本不在 socket 合法域名里，硬连只会失败）。
  //   多端 App：首选 → 公网直连 → 局域网；没有微信登录，不碰托管中继。
  // v3/中继二维码的中继是首选且唯一。

  /** 按当前运行时能力排序候选。network 传入当前网络类型（蜂窝下整族跳过局域网）。 */
  function orderedCandidates(table, preferred, options) {
    return routeTable.orderCandidates(table, Object.assign({
      client: runtime.clientKind(),
      preferred: preferred || null
    }, options || {}));
  }

  /** 当前网络下的选路附加参数：蜂窝整族跳过局域网；网络族真的变过才让局域网插队。 */
  function networkOptions(profile) {
    const network = routeTable.networkFamily(cachedNetworkType);
    const lastNetwork = routeTable.networkFamily(profile && profile.preferredNetwork);
    return {
      network: cachedNetworkType,
      promoteLan: network === 'wifi' && !!lastNetwork && lastNetwork !== 'wifi'
    };
  }

  /** 档案的候选列表：优先持久化路由表；旧档案（无 routeTable）从 endpoints 推导。 */
  function profileCandidates(profile, preferred, credential) {
    const savedTable = profile && profile.routeTable;
    const table = savedTable ? {
      lan: Array.isArray(savedTable.lan) ? savedTable.lan : [],
      public: Array.isArray(savedTable.public) ? savedTable.public : [],
      relay: savedTable.relay || null
    } : routeTable.parseRouteTable({
      endpoints: hosts.connectionEndpoints(profile)
    });
    // Older relay profiles stored only the endpoint and E2EE identity. Rebuild
    // their relay route instead of classifying /c/<nodeId> as a public direct URL.
    if (!table.relay && profile && profile.relay && profile.gatewayId && profile.relayAgentPubKey) {
      const relayPath = '/c/' + profile.gatewayId;
      const endpoint = hosts.connectionEndpoints(profile).find(value => value.endsWith(relayPath));
      if (endpoint) {
        table.relay = routeTable.normalizeRelay({
          relay: endpoint.slice(0, -relayPath.length),
          nodeId: profile.gatewayId,
          agentPubKey: profile.relayAgentPubKey,
          authMode: profile.relayAuthMode || 'invite',
          accessExpiresAt: profile.relayExpiresAt
        });
      }
    }
    const ordered = orderedCandidates(table, preferred !== undefined ? preferred : (profile && profile.preferredEndpoint), networkOptions(profile));
    // A v2 QR also gives a gateway-auth relay route. Once paired over LAN, the
    // saved device token can authenticate through that same E2EE relay; the
    // route's node id need not equal the gateway's own id.
    const pairedRelayReady = !!(profile && credential && credential.token && table.relay
      && table.relay.authMode === 'gateway');
    const profileRelayReady = !!(profile && profile.relay && profile.relayAgentPubKey
      && table.relay && profile.gatewayId === table.relay.nodeId);
    const relayReady = pairedRelayReady || profileRelayReady;
    const usable = relayReady ? ordered : ordered.filter(candidate => candidate.kind !== 'relay');
    // 网络过滤 + 缺少可用中继授权可能把候选一起清空。
    // 那时宁可拨一个注定失败的局域网地址，也不能一个都不拨：endpointCandidates 为空时
    // socket 一断就没有可轮换的候选，重连直接永久放弃。
    if (!usable.length && ordered.length) {
      const unfiltered = orderedCandidates(table, preferred !== undefined ? preferred : (profile && profile.preferredEndpoint),
        { network: '', promoteLan: false });
      return relayReady ? unfiltered : unfiltered.filter(candidate => candidate.kind !== 'relay');
    }
    if (!relayReady) return usable;
    if (!ordered.some(candidate => candidate.kind === 'relay')) {
      ordered.push({ endpoint: table.relay.endpoint, kind: 'relay', relay: table.relay });
    }
    return ordered;
  }

  /** 单个候选的连接参数：中继候选带 E2EE 元信息，直连候选用网关 Bearer token。 */
  function connectOptionsFor(profile, candidate, cred) {
    if (!candidate) return null;
    if (candidate.kind === 'relay') {
      const relay = candidate.relay || (profile.relay ? {
        authMode: profile.relayAuthMode || 'invite',
        nodeId: profile.gatewayId,
        agentPubKey: profile.relayAgentPubKey,
        accessExpiresAt: profile.relayExpiresAt
      } : null);
      if (!relay || !relay.agentPubKey || !relay.nodeId) return null;
      const authMode = profile.relay
        ? (profile.relayAuthMode || relay.authMode || 'invite')
        : (relay.authMode || 'invite');
      return {
        token: authMode === 'gateway' && cred ? cred.token : null,
        relay: {
          authMode: authMode,
          nodeId: relay.nodeId,
          agentPubKey: relay.agentPubKey,
          accessToken: profile.relayAccessToken || null,
          role: profile.relayRole || 'guest',
          expiresAt: profile.relayExpiresAt || relay.accessExpiresAt || null
        }
      };
    }
    return cred && cred.token ? { token: cred.token } : null;
  }

  /** 建立配对连接：复用同身份档案，否则新建（iOS pair 对齐）。 */
  function beginPairing(endpoint, code, payload) {
    const normalized = payload
      ? hosts.normalizeEndpoints(payload.publicUrl, payload.endpoints)
      : [hosts.normalizeEndpoint(endpoint)].filter(Boolean);
    if (!normalized || !normalized.length) {
      return { ok: false, error: hosts.ErrorText.address };
    }
    // 路由表：优先载荷里的显式 routes；旧载荷按地址特征从 publicUrl/endpoints 推导。
    const table = (payload && payload.routeTable)
      || routeTable.parseRouteTable({ publicUrl: normalized[0], endpoints: normalized });
    // v2 直连载荷按客户端能力排序（小程序中继优先、App 公网优先）；v3 中继载荷只连中继。
    // 蜂窝网络下局域网一条都不可达，直接不列——别让手机在外网时先撞一个 8s 超时。
    const candidates = payload && payload.mode === 'relay'
      ? [{ endpoint: normalized[0], kind: 'relay' }]
      : orderedCandidates(table, null, networkOptions(null));
    if (!candidates.length) {
      return { ok: false, error: hosts.ErrorText.address };
    }
    endpointCandidates = candidates.map(candidate => candidate.endpoint);
    endpointCandidateMeta = candidates.slice();
    endpointIdx = 0;
    const gid = payload && payload.gatewayId ? String(payload.gatewayId).toLowerCase() : null;
    let profile = null;
    for (let i = 0; i < state.profiles.length; i += 1) {
      const p = state.profiles[i];
      if (gid ? p.gatewayId === gid : (!p.gatewayId && p.endpoints.indexOf(normalized[0]) >= 0)) {
        profile = p;
        break;
      }
    }
    const hostPart = hostLabelFromEndpoint(normalized[0]);
    const gatewayName = (payload && payload.gatewayName) || hostPart || uiText('新主机');
    // 设备类型：显式 deviceKind > 配对载荷 hostPlatform > 主机名特征 > 默认电脑。
    const device = hosts.deriveDeviceKind({
      deviceKind: payload && payload.deviceKind,
      platform: payload && payload.hostPlatform,
      gatewayName: gatewayName
    });
    const explicitKind = device.source === 'payload' || device.source === 'platform';
    if (!profile) {
      profile = hosts.newProfile({
        gatewayId: gid,
        gatewayName: gatewayName,
        endpoints: normalized,
        preferredEndpoint: normalized[0],
        deviceKind: device.kind,
        deviceKindSource: explicitKind ? 'payload' : 'auto'
      });
    }
    // 重新扫码代表用户重新确认了这台主机：自动识别的类型可以刷新；
    if (profile.deviceKindSource !== 'user'
      && (explicitKind || profile.deviceKindSource !== 'payload')) {
      profile.deviceKind = device.kind;
      profile.deviceKindSource = explicitKind ? 'payload' : 'auto';
    }
    // 重新扫码代表用户明确认可本次地址集合；publicUrl 优先（iOS pair 对齐）。
    profile.endpoints = normalized;
    profile.preferredEndpoint = normalized[0];
    // 持久化整张路由表：重连时按当前网络重新选路，不需要重新扫码。
    profile.routeTable = table;
    if (payload && String(payload.gatewayName || '').trim()) profile.gatewayName = payload.gatewayName;
    // v3 relay 支持邀请鉴权及插件配对码；后者保存手机独立的网关凭据。
    if (payload && payload.mode === 'relay') {
      profile.relay = true;
      profile.relayAgentPubKey = payload.agentPubKey || null;
      profile.relayAuthMode = payload.authMode || 'invite';
      profile.relayRole = payload.role || 'guest';
      profile.relayInviteExpiresAt = payload.expiresAt;
      profile.relayAccessToken = null;
      profile.relayExpiresAt = payload.authMode === 'gateway' ? payload.accessExpiresAt || null : null;
      // 中继链路没有 paired/hello 提交帧（E2EE 握手是二进制协议）：
      profile.lastConnectedAt = Date.now();
      upsertProfile(profile);
      state.activeID = profile.id;
      hosts.setActiveID(profile.id);
      state.profiles = state.profiles.slice();
      pendingProfile = null;
      emit();
    } else {
      // v2 直连载荷一律先按直连档案配对：中继是否成为档案的认证模型，由真正
      // 连通的线路决定（connected 时按 client.routeKind 升级）。提前按首选候选
      // 打标记会在中继失败、局域网胜出时留下错误的中继元信息。
      profile.relay = false;
      profile.relayAgentPubKey = null;
      pendingProfile = profile;
    }
    state.endpoint = endpointCandidates[0];
    state.gatewayName = hosts.displayName(profile);
    state.gatewayId = profile.gatewayId;
    pendingPairing = true;
    if (payload && payload.mode === 'relay') {
      client.connect(normalized[0], {
        pairingCode: code,
        relay: {
          authMode: payload.authMode || 'invite',
          nodeId: payload.nodeId || profile.gatewayId,
          agentPubKey: payload.agentPubKey,
          inviteToken: payload.inviteToken,
          role: payload.role
        },
        candidateKinds: ['relay'],
        routeKind: 'relay'
      });
    } else {
      const primary = endpointCandidateMeta[0];
      client.connect(primary.endpoint, {
        pairingCode: code,
        endpointCandidates: endpointCandidates.slice(1),
        // 回退候选的中继元信息（与 endpointCandidates 对齐）：中继保底候选
        // 需要 E2EE 元信息才能连上，直连候选为 null。
        relayCandidates: endpointCandidateMeta.slice(1).map(candidate => candidate.relay || null),
        candidateKinds: endpointCandidateMeta.map(candidate => candidate.kind),
        routeKind: primary.kind,
        ...(primary.relay ? { relay: {
          authMode: primary.relay.authMode,
          nodeId: primary.relay.nodeId,
          agentPubKey: primary.relay.agentPubKey
        } } : {})
      });
    }
    return { ok: true };
  }

  /** 旧版单主机全局凭据迁移为第一条主机档案。 */
  function migrateLegacyCredentials() {
    try {
      const endpoint = wx.getStorageSync(STORAGE_KEYS.endpoint);
      const token = wx.getStorageSync(STORAGE_KEYS.token);
      if (!endpoint || !token) return;
      if (hosts.loadProfiles().length) return;
      const hostPart = hostLabelFromEndpoint(endpoint);
      const legacyKind = hosts.deriveDeviceKind({ gatewayName: hostPart });
      const profile = hosts.newProfile({
        gatewayName: hostPart || uiText('原有主机'),
        endpoints: [endpoint],
        preferredEndpoint: endpoint,
        deviceKind: legacyKind.kind,
        deviceKindSource: 'auto'
      });
      hosts.saveCredential(profile.id, endpoint, token);
      hosts.saveProfiles([profile]);
      hosts.setActiveID(profile.id);
      wx.removeStorageSync(STORAGE_KEYS.endpoint);
      wx.removeStorageSync(STORAGE_KEYS.token);
    } catch (e) { /* 忽略 */ }
  }

  /** 连接激活档案（凭据按档案 ID 读取）。 */
  let endpointCandidates = [];
  let endpointCandidateMeta = []; // 与 endpointCandidates 对齐：{ endpoint, kind, relay? }
  let endpointIdx = 0;
  let rotationTimer = null;
  // 当前网络类型（wifi/2g/3g/4g/5g/unknown/none）。选路要同步读它，而
  // wx.getNetworkType 是异步的，所以在初始化、连接成功和网络变化时各刷新一次。
  let cachedNetworkType = '';
  let lastNetworkFamily = '';

  /** 重置候选顺序并连接首选线路（网络恢复/回前台时用，避免死守不可达候选） */
  function reconnectPreferred() {
    endpointCandidates = [];
    endpointCandidateMeta = [];
    endpointIdx = 0;
    if (rotationTimer) { clearTimeout(rotationTimer); rotationTimer = null; }
    return connectActiveProfile();
  }

  function connectActiveProfile() {
    const profile = getProfile(state.activeID);
    if (!profile) return false;
    const cred = hosts.loadCredential(profile.id);
    // 按当前网络重新选路：上次连通的线路优先，其次公网/局域网/中继保底。
    const candidates = profileCandidates(profile, undefined, cred);
    const endpoint = (candidates[0] && candidates[0].endpoint) || (cred && cred.endpoint) || null;
    endpointCandidates = candidates.map(candidate => candidate.endpoint);
    endpointCandidateMeta = candidates.slice();
    endpointIdx = 0;
    if (!endpoint) {
      state.connection = 'disconnected';
      state.connectionMessage = uiText('缺少连接凭据，请重新扫码配对');
      emit();
      return false;
    }
    state.endpoint = endpoint;
    state.gatewayName = hosts.displayName(profile);
    state.gatewayId = profile.gatewayId;
    // 配对码模式的长期凭据由手机保存，经 E2EE 交给主机，不发给中继。
    // 连接参数按首选候选的线路族构建（中继/直连自动区分）。
    const primaryMeta = endpointCandidateMeta[0] || { endpoint: endpoint, kind: 'lan' };
    const connectOpts = connectOptionsFor(profile, primaryMeta, cred);
    if (primaryMeta.kind === 'relay') {
      const relayAuthMode = (primaryMeta.relay && primaryMeta.relay.authMode) || profile.relayAuthMode;
      if (relayAuthMode === 'gateway' && (!cred || !cred.token)) {
        state.connection = 'disconnected';
        state.connectionMessage = uiText('缺少配对凭据，请重新扫描 DSH 的二维码');
        emit();
        return false;
      }
    } else if (!cred || !cred.token) {
      state.connection = 'disconnected';
      state.connectionMessage = uiText('缺少连接凭据，请重新扫码配对');
      emit();
      return false;
    }
    if (!connectOpts) {
      state.connection = 'disconnected';
      state.connectionMessage = uiText('缺少连接凭据，请重新扫码配对');
      emit();
      return false;
    }
    client.lastToken = connectOpts.relay ? null : cred.token;
    client.connect(primaryMeta.endpoint, Object.assign({}, connectOpts, {
      candidateKinds: endpointCandidateMeta.map(candidate => candidate.kind),
      relayCandidates: endpointCandidateMeta.slice(1).map(candidate => candidate.relay || null),
      routeKind: primaryMeta.kind
    }));
    return true;
  }

  /** 切换/删除主机时清空上一台主机的业务数据。 */
  function resetDataState() {
    state.workspaces = [];
    state.archivedSessionIds = [];
    state.currentWorkspaceId = null;
    state.isUngroupedWorkspaceSelected = false;
    state.sessions = [];
    state.searchQuery = '';
    state.searchResults = null;
    state.host = null;
    state.gatewayMetadata = null;
    state.clientCount = null;
    state.defaultModel = null;
    state.agentPresets = null;
    state.modelCatalog = null;
    state.coreCompatibilityError = '';
    state.gatewayName = null;
    state.gatewayId = null;
    state.paired = false;
    state.rpcError = '';
    state.lastWorkspacesFrame = null;
    state.lastSessionsFrame = null;
    state.scheduledTasks = [];
    state.scheduledTasksLoading = false;
    state.scheduledTasksError = null;
    state.scheduledTaskPendingId = null;
    state.scheduleCompletedRequestId = null;
    state.scheduleMutationError = null;
    scheduleMutation = null;
    scheduleLoadedOnce = false;
    state.pluginCatalog = null;
    state.pluginInstall = null;
    state.pluginsLoading = false;
    state.pluginsError = null;
    state.pluginPendingName = null;
    state.pluginNotice = null;
    pluginToggleToken = null;
    sessionState.sessionId = null;
    sessionState.collaboration = collaboration.create(null);
    sessionState.rowsAgg = null;
    sessionState.rows = [];
    sessionState.trajectory = [];
    trajectoryDirty = true; trajectoryActive = false;
    contextActive = false;
    fleetActive = false;
    stopContextPolling();
    sessionState.title = '';
    sessionState.agentPreset = null;
    sessionState.agentPresetAsOfSeq = null;
    sessionState.agentPresetAuthoritative = false;
    sessionState.pendingQuestion = null;
    sessionState.pendingApproval = null;
    sessionState.questionStatus = 'idle';
    sessionState.approvalStatus = 'idle';
    sessionState.stats = null;
    sessionState.contextDashboard = createContextDashboardState();
    sessionState.contextFleet = createContextFleetState();
    sessionState.tasks = null;
    sessionState.tasksAsOfSeq = null;
    sessionState.goal = null;
    sessionState.goalAsOfSeq = null;
    sessionState.goalMutation = '';
    sessionState.commandGroups = [];
    sessionState.commandOptions = [];
    sessionState.commandOptionsFor = '';
    sessionState.commandLoading = false;
    sessionState.commandError = '';
    setRawBuffer([]);
    runCueWatermark = -1;
    sessionState.runStartMs = null;
    sessionState.runCues = [];
  }

  // ---------- 原生浮层期间的连接抑制 ----------

  let nativeOverlayDepth = 0;
  let appActive = false;
  let foregroundPing = null;
  let healthTimer = null;
  const FOREGROUND_PING_TIMEOUT_MS = 2500;
  // 连接静默自检：socket 掉线时 onClose 不一定及时（弱网/息屏），
  const HEALTH_PING_INTERVAL_MS = 45000;

  function syncHealthCheck() {
    if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
    if (!appActive || state.connection !== 'connected') return;
    healthTimer = setInterval(function () {
      if (!appActive || nativeOverlayDepth > 0 || state.connection !== 'connected') return;
      if (typeof client.ping !== 'function') return;
      Promise.resolve(client.ping(FOREGROUND_PING_TIMEOUT_MS)).catch(function () {
        if (appActive && nativeOverlayDepth === 0 && state.connection === 'connected' &&
            typeof client.handleTransportFailure === 'function') {
          client.handleTransportFailure(uiText('连接无响应'));
        }
      });
    }, HEALTH_PING_INTERVAL_MS);
  }

  function maybeReconnectOnActive() {
    if (nativeOverlayDepth > 0) return;
    if (!state.activeID || state.connection === 'connecting') return;
    if (state.connection === 'connected') {
      // onLaunch is commonly followed immediately by onShow, and native pickers
      if (foregroundPing || typeof client.ping !== 'function') return;
      const check = { client, generation: client.connectGeneration };
      foregroundPing = check;
      Promise.resolve(client.ping(FOREGROUND_PING_TIMEOUT_MS)).then(function () {}, function () {
        if (foregroundPing !== check) return;
        foregroundPing = null;
        if (appActive && nativeOverlayDepth === 0 && check.client === client &&
            check.generation === client.connectGeneration && state.connection === 'connected') {
          reconnectPreferred();
        }
      }).then(function () {
        if (foregroundPing === check) foregroundPing = null;
      });
      return;
    }
    reconnectPreferred();
  }

  function selectHost(id) {
    const profile = getProfile(id);
    if (!profile) return;
    if (state.activeID === id && state.connection === 'connected') return;
    stopHostProbes();
    client.disconnect();
    client.lastToken = null;
    resetDataState();
    state.activeID = id;
    hosts.setActiveID(id);
    const savedDefaults = loadDefaults();
    if (savedDefaults) state.defaults = savedDefaults;
    connectActiveProfile();
    emit();
  }

  function editHost(id, alias, kind) {
    const profile = getProfile(id);
    if (!profile) return;
    profile.alias = String(alias || '').trim().slice(0, 80);
    profile.deviceKind = kind === 'server.rack' ? 'server.rack' : 'desktopcomputer';
    profile.deviceKindSource = 'user';
    hosts.saveProfiles(state.profiles);
    if (state.activeID === id) state.gatewayName = hosts.displayName(profile);
    emit();
  }

  function removeHosts(ids) {
    const known = state.profiles.filter(function (p) { return ids.indexOf(p.id) >= 0; });
    if (!known.length) return;
    stopHostProbes();
    const removingActive = known.filter(function (p) { return p.id === state.activeID; }).length > 0;
    known.forEach(function (p) { hosts.forgetCredential(p.id); });
    state.profiles = state.profiles.filter(function (p) { return ids.indexOf(p.id) < 0; });
    hosts.saveProfiles(state.profiles);
    if (removingActive) {
      client.disconnect();
      client.lastToken = null;
      resetDataState();
      state.activeID = null;
      state.endpoint = null;
      hosts.setActiveID(null);
      state.connection = 'disconnected';
      state.connectionMessage = null;
    }
    state.onlineIDs = state.onlineIDs.filter(function (id) { return ids.indexOf(id) < 0; });
    emit();
  }

  function forgetHostRemotely(profile) {
    if (profile.id === state.activeID && state.connection === 'connected' &&
        client.state === 'connected' && typeof client.forgetDevice === 'function') {
      return client.forgetDevice(4500).then(function () { return true; }).catch(function () { return false; });
    }

    const credential = hosts.loadCredential(profile.id);
    const authMode = profile.relayAuthMode || 'invite';
    if (profile.relay && authMode !== 'gateway' && !profile.relayAccessToken) return Promise.resolve(false);
    if (!profile.relay && (!credential || !credential.token)) return Promise.resolve(false);
    const endpoints = hosts.connectionEndpoints(profile).slice(0, 3);
    if (credential && credential.endpoint && endpoints.indexOf(credential.endpoint) < 0 && endpoints.length < 3) {
      endpoints.push(credential.endpoint);
    }
    if (!endpoints.length) return Promise.resolve(false);

    return new Promise(function (resolve) {
      let index = 0;
      let done = false;
      let activeClient = null;
      let attemptTimer = null;
      let attemptNumber = 0;

      function finish(revoked) {
        if (done) return;
        done = true;
        if (attemptTimer) clearTimeout(attemptTimer);
        if (activeClient) activeClient.disconnect();
        resolve(revoked);
      }

      function retry(expectedAttempt) {
        if (done || expectedAttempt !== undefined && expectedAttempt !== attemptNumber) return;
        if (attemptTimer) { clearTimeout(attemptTimer); attemptTimer = null; }
        if (activeClient) activeClient.disconnect();
        activeClient = null;
        tryNext();
      }

      function tryNext() {
        if (done || index >= endpoints.length) return finish(false);
        const endpoint = endpoints[index++];
        const currentAttempt = ++attemptNumber;
        let forgetRequested = false;
        const temporary = new GatewayClient({
          onState: function (status) {
            if (done || currentAttempt !== attemptNumber) return;
            if (status === 'connected' && !forgetRequested) {
              forgetRequested = true;
              temporary.forgetDevice(4500).then(function () { finish(true); }, function () { retry(currentAttempt); });
            } else if (status === 'failed') retry(currentAttempt);
          }
        });
        activeClient = temporary;
        const options = { token: credential && credential.token, probe: true };
        if (profile.relay) {
          options.token = authMode === 'gateway' && credential ? credential.token : null;
          options.relay = {
            authMode,
            nodeId: profile.gatewayId,
            agentPubKey: profile.relayAgentPubKey,
            accessToken: profile.relayAccessToken || null,
            expiresAt: profile.relayExpiresAt || null,
            role: profile.relayRole || 'guest'
          };
        }
        attemptTimer = setTimeout(function () { retry(currentAttempt); }, 8000);
        temporary.connect(endpoint, options);
      }

      tryNext();
    });
  }

  function forgetHosts(ids) {
    const targetIds = Array.isArray(ids) ? Array.from(new Set(ids)) : [];
    const selected = state.profiles.filter(function (profile) { return targetIds.indexOf(profile.id) >= 0; });
    if (!selected.length) return Promise.resolve({ removed: 0, revoked: 0, failed: 0 });
    return Promise.all(selected.map(forgetHostRemotely)).then(function (results) {
      removeHosts(targetIds);
      const revoked = results.filter(Boolean).length;
      return { removed: selected.length, revoked: revoked, failed: selected.length - revoked };
    });
  }

  // ---------- 在线探测（iOS refreshPresence 对齐） ----------

  let probeClients = [];
  let probeToken = 0;

  function probeProfile(profile) {
    const cred = hosts.loadCredential(profile.id);
    if (profile.relay && profile.relayAuthMode !== 'gateway'
      ? !profile.relayAccessToken : (!cred || !cred.token)) return Promise.resolve(false);
    const endpoints = hosts.connectionEndpoints(profile);
    return new Promise(function (resolve) {
      let index = 0;
      let done = false;
      let probeClient = null;
      let timer = null;
      function detach() {
        if (probeClient) {
          probeClient.disconnect();
          probeClients = probeClients.filter(function (c) { return c !== probeClient; });
          probeClient = null;
        }
      }
      function finish(online) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        detach();
        resolve(online);
      }
      function tryNext() {
        if (index >= endpoints.length) return finish(false);
        const endpoint = endpoints[index];
        index += 1;
        probeClient = new GatewayClient({
          onFrame: function (frame) {
            if (frame.kind === 'hello' || frame.kind === 'paired') finish(true);
          }
        });
        probeClients.push(probeClient);
        const probeOpts = { token: cred && cred.token, probe: true };
        if (profile.relay) {
          probeOpts.token = profile.relayAuthMode === 'gateway' && cred ? cred.token : null;
          probeOpts.relay = {
            authMode: profile.relayAuthMode || 'invite',
            nodeId: profile.gatewayId,
            agentPubKey: profile.relayAgentPubKey,
            accessToken: profile.relayAccessToken || null,
            expiresAt: profile.relayExpiresAt || null
          };
        }
        probeClient.connect(endpoint, probeOpts);
        timer = setTimeout(function () {
          detach();
          tryNext();
        }, 3000);
      }
      tryNext();
    });
  }

  function refreshHostPresence() {
    const myToken = ++probeToken;
    probeClients.forEach(function (c) { c.disconnect(); });
    probeClients = [];
    const online = [];
    if (state.activeID && state.connection === 'connected') online.push(state.activeID);
    const candidates = state.profiles.filter(function (p) {
      return p.id !== state.activeID || state.connection !== 'connected';
    });
    let chain = Promise.resolve();
    candidates.forEach(function (profile) {
      chain = chain.then(function () {
        if (myToken !== probeToken) return false;
        return probeProfile(profile).then(function (ok) {
          if (ok) online.push(profile.id);
          if (myToken === probeToken) {
            state.onlineIDs = online.slice();
            emit();
          }
          return ok;
        });
      });
    });
    return chain.then(function () {
      if (myToken === probeToken) {
        state.onlineIDs = online.slice();
        emit();
      }
    });
  }

  function stopHostProbes() {
    probeToken += 1;
    probeClients.forEach(function (c) { c.disconnect(); });
    probeClients = [];
    state.onlineIDs = (state.activeID && state.connection === 'connected') ? [state.activeID] : [];
    emit();
  }

  // ---------- 公共 API ----------

  return {
    state: state,
    sessionState: sessionState,
    client: client,

    init: function () {
      try {
        migrateLegacyCredentials();
        state.profiles = hosts.loadProfiles();
        const savedDefaults = wx.getStorageSync(STORAGE_KEYS.defaults);
        if (savedDefaults) state.defaults = savedDefaults;
        const activeID = hosts.loadActiveID();
        const known = state.profiles.filter(function (p) { return p.id === activeID; });
        state.activeID = known.length ? activeID : (state.profiles[0] ? state.profiles[0].id : null);
        // 本地缓存立即可呈现（对齐 iOS「Cached content is immediately presentable」）：
        if (state.activeID) {
          const cacheResult = loadCompatibleHomeCache(state.activeID);
          if (cacheResult) {
            const cached = cacheResult.cache;
            state.sessions = cached.sessions || [];
            state.workspaces = cached.workspaces || [];
            state.archivedSessionIds = cached.archivedSessionIds || [];
            state.isUngroupedWorkspaceSelected = cached.isUngroupedWorkspaceSelected === true;
            state.currentWorkspaceId = state.isUngroupedWorkspaceSelected ? null : (cached.currentWorkspaceId || null);
            state.homeCacheAt = cached.savedAt || 0;
            state.lastSessionsFrame = {
              count: state.sessions.length,
              keys: uiText('本地缓存'),
              at: cached.savedAt || Date.now(),
              cached: true
            };
            state.lastWorkspacesFrame = {
              count: state.workspaces.length,
              keys: uiText('本地缓存'),
              at: cached.savedAt || Date.now(),
              cached: true
            };
          }
        }
        if (state.activeID) {
          hosts.setActiveID(state.activeID);
          const scopedDefaults = loadDefaults();
          if (scopedDefaults) state.defaults = scopedDefaults;
          connectActiveProfile();
        }
        // 网络变化（WiFi/蜂窝切换、飞行模式关闭）：刷新网络类型，让下次选路按新网络分流。
        // 只有「当前线路在新网络下确实已经不可用」时才就地重连——局域网线路在蜂窝下
        // 一定不通，socket 迟早会断，早换早好。其余情况绝不主动拆连接：微信偶尔会报一次
        // 瞬时的 4g/unknown，把一条好连接拆掉才是真故障；下次自然重连会按新网络选路，
        // 该跳过局域网还是会跳过。
        if (wx.onNetworkStatusChange) {
          wx.onNetworkStatusChange(function (res) {
            const info = res || {};
            if (info.networkType) cachedNetworkType = info.networkType;
            const family = routeTable.networkFamily(cachedNetworkType);
            if (family) lastNetworkFamily = family;
            if (!info.isConnected || !state.activeID) return;
            const current = endpointCandidateMeta[endpointIdx] || {};
            const routeDead = current.kind === 'lan' && family === 'cellular';
            if (state.connection === 'connected' && !routeDead) return;
            if (routeDead || state.connection !== 'connected') reconnectPreferred();
          });
        }
        // 首屏也要知道网络类型，否则第一次选路拿不到它。
        if (typeof wx.getNetworkType === 'function') {
          try {
            wx.getNetworkType({
              success: function (res) {
                cachedNetworkType = (res && res.networkType) || '';
                const family = routeTable.networkFamily(cachedNetworkType);
                if (family) lastNetworkFamily = family;
                // The first socket may already be dialing a saved LAN endpoint:
                // getNetworkType is async, so a cold start on cellular can only
                // discover that route is dead after connectActiveProfile ran.
                const current = endpointCandidateMeta[endpointIdx] || {};
                if (state.activeID && family === 'cellular' && current.kind === 'lan') {
                  const profile = getProfile(state.activeID);
                  const credential = profile && hosts.loadCredential(profile.id);
                  const preferred = profile && profileCandidates(profile, undefined, credential)[0];
                  if (preferred && preferred.endpoint !== current.endpoint) reconnectPreferred();
                }
              },
              fail: function () {}
            });
          } catch (e) { /* 老版本微信没有这个 API，选路退化为不过滤 */ }
        }
      } catch (e) {
        // 初始化失败不能静默吞掉，否则 UI 只会表现为“选择主机/空列表”，
        // 无法区分无凭据和持久化数据解析失败。
        state.connection = 'disconnected';
        state.connectionMessage = uiText('初始化失败：') + ((e && e.message) || String(e));
        state.rpcError = state.connectionMessage;
        emit();
      }
    },

    appDidBecomeActive: function () {
      appActive = true;
      syncHealthCheck();
      maybeReconnectOnActive();
    },

    appDidEnterBackground: function () {
      appActive = false;
      syncHealthCheck();
      // 小程序无真正后台 WebSocket 保活；交由平台管理，仅记录状态。
    },

    /** 原生浮层（chooseMedia 等）打开：挂起重连直到浮层全部关闭。 */
    beginNativeOverlay: function () {
      nativeOverlayDepth += 1;
    },

    /** 原生浮层关闭：若已无浮层且 app 在前台，补一次可能被挂起的重连。 */
    endNativeOverlay: function () {
      if (nativeOverlayDepth > 0) nativeOverlayDepth -= 1;
      if (nativeOverlayDepth === 0 && appActive) maybeReconnectOnActive();
    },

    /** 是否有原生浮层正打开（用于区分「浮层导致的 onHide」与「页面跳转」）。 */
    nativeOverlayActive: function () {
      return nativeOverlayDepth > 0;
    },

    subscribe: function (listener) {
      listeners.push(listener);
      return function unsubscribe() {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },

    /** 扫码/手动配对：解析载荷并以一次性配对码连接。 */
    pairWithPayload: function (raw) {
      const result = pairing.parse(raw, Date.now());
      if (!result.ok) return result;
      const payload = result.payload;
      // A user-supplied one-time pairing payload explicitly confirms its endpoint;
      // manual address entry remains restricted to endpoints trusted earlier.
      return beginPairing(payload.publicUrl, payload.pairingCode, payload);
    },

    /** 所有者生成兑换码（续期 accessTtlMs，可用 uses 次，码本身 codeTtlMs 有效） */
    createRedeemCode: function (accessTtlMs, uses, codeTtlMs) {
      const profile = getProfile(state.activeID);
      if (!profile || !profile.relay || profile.relayRole !== 'owner' || !profile.relayAccessToken) {
        return Promise.reject(new Error(uiText('只有所有者账号可以生成兑换码')));
      }
      return client.createRelayCode(accessTtlMs, uses, codeTtlMs).then(function (res) {
        return {
          code: res.code,
          expiresAt: Number(res.expiresAt) || 0,
          accessTtlMs: Number(res.accessTtlMs) || accessTtlMs,
          uses: Number(res.uses) || uses
        };
      });
    },

    /** 兑换续期码：成功后更新本地记录的有效期 */
    redeemCode: function (code) {
      const normalized = String(code || '').trim().toUpperCase();
      if (!normalized) return Promise.reject(new Error(uiText('请输入兑换码')));
      const profile = getProfile(state.activeID);
      if (!profile || !profile.relay) return Promise.reject(new Error(uiText('当前节点不在公网模式')));
      return client.redeemRelayCode(normalized).then(function (res) {
        const expiresAt = Number(res.expiresAt) || 0;
        const target = state.profiles.find(function (item) { return item.id === profile.id; });
        if (target && expiresAt) target.relayExpiresAt = expiresAt;
        hosts.saveProfiles(state.profiles);
        emit();
        return { expiresAt: expiresAt, remainingUses: Number(res.remainingUses) || 0 };
      });
    },

    createRelayShare: function (ttlMs) {
      const profile = getProfile(state.activeID);
      if (!profile || !profile.relay || profile.relayRole !== 'owner' || !profile.relayAccessToken) {
        return Promise.reject(new Error(uiText('只有已完成所有者配对的公网节点可以创建分享')));
      }
      return client.createRelayShare(ttlMs).then(function (invite) {
        const endpoint = profile.endpoints[0] || '';
        const payload = {
          version: 3,
          mode: 'relay',
          relay: endpoint.replace(/\/c\/[^/]+$/, ''),
          nodeId: profile.gatewayId,
          agentPubKey: profile.relayAgentPubKey,
          gatewayName: profile.alias || profile.gatewayName,
          inviteToken: invite.inviteToken,
          expiresAt: invite.expiresAt,
          role: 'guest'
        };
        return { raw: util.encodeBase64URL(JSON.stringify(payload)), expiresAt: invite.expiresAt };
      });
    },

    pairManual: function (endpoint, pairingCode) {
      const normalized = String(endpoint || '').trim().replace(/\/+$/, '');
      if (!/^wss?:\/\//.test(normalized)) {
        return { ok: false, error: uiText('请输入以 ws:// 或 wss:// 开头的 WebSocket 地址') };
      }
      const code = String(pairingCode || '').trim();
      if (!code || /\s/.test(code)) {
        return { ok: false, error: uiText('一次性配对码无效') };
      }
      // 手动输入只用于 v2 直连（v3 走扫码载荷），保留白名单校验。
      if (!isTrustedEndpoint(normalized)) {
        return { ok: false, error: uiText('地址未经此主机确认，请重新扫码添加地址。') };
      }
      // 微信小程序的 socket 必须命中合法域名：运营者自己的公网直连地址（Cloudflare/
      // 反代）基本不在列表里，硬连只会拿到「域名不合法」。直接说明原因，并指出
      // 小程序可用的两条路（扫码走中继/局域网，或改用 App 直连）。
      if (routeTable.classifyEndpoint(normalized) === 'public' && runtime.clientKind() === 'wechat') {
        return { ok: false, error: uiText('微信小程序不能直接连接公网地址：它的域名不在小程序网络合法域名里。请扫描 DSH 插件的二维码（自动走中继或局域网），或在 App 里直连该地址。') };
      }
      return beginPairing(normalized, code, null);
    },

    reconnectWithSaved: function () {
      return connectActiveProfile();
    },

    forgetDevice: function () {
      if (state.activeID) return forgetHosts([state.activeID]);
      return Promise.resolve({ removed: 0, revoked: 0, failed: 0 });
    },

    /** 切换激活主机：断开当前连接并以目标档案凭据重连（iOS select 对齐）。 */
    selectHost: function (id) {
      selectHost(id);
    },

    /** 编辑主机别名与设备类型。 */
    editHost: function (id, alias, kind) {
      editHost(id, alias, kind);
    },

    /** 移除主机档案及连接凭证（不删除网关上的会话/工作区）。 */
    removeHosts: function (ids) {
      removeHosts(ids);
    },

    /** 首先用已配对凭据在对应网关吊销当前设备，再删除本机档案。 */
    forgetHosts: function (ids) {
      return forgetHosts(ids);
    },

    /** 探测全部主机在线状态（更新 state.onlineIDs）。 */
    refreshHostPresence: function () {
      return refreshHostPresence();
    },

    stopHostProbes: function () {
      stopHostProbes();
    },

    /** 本地更新会话标题（重命名后立即生效，无需等待 Host 回帧）。 */
    setSessionTitle: function (sessionId, title) {
      const id = String(sessionId || '');
      const next = String(title == null ? '' : title).trim();
      if (!id || !next) return false;
      let changed = false;
      if (sessionState.sessionId === id && sessionState.title !== next) {
        sessionState.title = next;
        changed = true;
      }
      const list = state.sessions || [];
      for (let i = 0; i < list.length; i += 1) {
        if (list[i] && list[i].sessionId === id) {
          list[i] = Object.assign({}, list[i], { title: next });
          changed = true;
        }
      }
      if (changed) emit();
      return changed;
    },

    /** 打开会话：重置会话投影并订阅。 */
    openSession: function (sessionId, title, agentPreset) {
      // 看过就清「刚完成」标记：首页绿点立刻变灰，不用等 24h。
      clearCompleted(sessionId);
      saveSessionCache(sessionState.sessionId, sessionState.rows);
      clearSessionDetailsBootstrap();
      clearSessionStatsBootstrap();
      clearStatsRetry();
      resetHistoryPaging();
      clearLiveAttempt();
      if (sessionBootstrapTimer) { clearTimeout(sessionBootstrapTimer); sessionBootstrapTimer = null; }
      // 切会话：停掉旧会话的自动刷新，避免旧请求/旧 timer 污染新面板。
      stopContextPolling();
      // 订阅成功就等快照；失败/未连接才立即走 history。
      clearHistoryFallback();
      sessionState.sessionId = sessionId;
      sessionCacheScope = activeCacheScope();
      sessionState.lastEventAt = 0;
      sessionState.collaboration = collaboration.create(sessionId);
      sessionState.cacheDisplay = false;
      sessionState.rowsAgg = protocol.newAggregator();
      sessionState.rows = [];
      sessionState.trajectory = [];
      trajectoryDirty = true;
      sessionState.title = title || '';
      const listedSession = state.sessions.find(item => item.sessionId === sessionId);
      sessionState.agentPreset = listedSession && typeof listedSession.agentPreset === 'string'
        ? listedSession.agentPreset : (typeof agentPreset === 'string' ? agentPreset : null);
      sessionState.agentPresetAsOfSeq = listedSession ? listedSession.agentPresetAsOfSeq : null;
      sessionState.agentPresetAuthoritative = false;
      sessionState.historyError = '';
      sessionState.hasMoreHistory = false;
      sessionState.nextBeforeSeq = null;
      sessionState.pendingQuestion = null;
      sessionState.pendingApproval = null;
      sessionState.stats = null;
      sessionState.turnUsage = {};
      {
        const cachedPanels = restoreContextPanels(sessionId);
        sessionState.contextDashboard = cachedPanels.dashboard
          ? Object.assign({}, cachedPanels.dashboard, { loading: true })
          : createContextDashboardState();
        sessionState.contextFleet = cachedPanels.fleet
          ? Object.assign({}, cachedPanels.fleet, { loading: true })
          : createContextFleetState();
      }
      sessionState.queue = [];
      sessionState.tasks = null;
      sessionState.tasksAsOfSeq = null;
      sessionState.goal = null;
      sessionState.goalAsOfSeq = null;
      sessionState.goalMutation = '';
      sessionState.commandGroups = [];
      sessionState.commandOptions = [];
      sessionState.commandOptionsFor = '';
      sessionState.commandLoading = false;
      sessionState.commandError = '';
      setRawBuffer([]);
      runCueWatermark = -1;
      sessionState.runStartMs = null;
      sessionState.runCues = [];
      // 运行态以主机为准：先用已知会话列表播种，再主动补拉一次，
      {
        const listed = state.sessions.find(function (x) { return x.sessionId === sessionId; });
        setRunning(listed ? listed.running === true : false);
      }
      sessionState.ingestErrors = 0;
      // 缓存命中：立即呈现上次内容（iOS 缓存立即可呈现），history 帧到达后无缝替换
      const cached = loadSessionCache(sessionId);
      if (cached) {
        sessionState.rows = cached.rows;
        sessionState.trajectory = [];
        trajectoryDirty = true;
        sessionState.hasMoreHistory = cached.hasMore === true;
        sessionState.nextBeforeSeq = cached.nextBeforeSeq;
        sessionState.historyFormatVersion = cached.historyFormatVersion;
        setRawBuffer(Array.isArray(cached.events) ? cached.events.slice() : []);
        sessionState.stats = cached.stats || null;
        sessionState.turnUsage = cached.turnUsage || turnUsage.deriveAll(rawBuffer);
        sessionState.historyState = 'loaded:cached';
        sessionState.cacheDisplay = true;
      } else {
        sessionState.historyState = 'requested';
        sessionState.cacheDisplay = false;
      }
      const subOk = client.subscribe(sessionId, sessionResumeCursor());
      if (subOk && state.connection === 'connected') snapshotPendingFor = sessionId;
      else sessionState.historyState = sessionState.cacheDisplay ? 'loaded:cached' : 'sub-failed';
      emit();
      // 订阅成功后网关会推一份 session-snapshot（内容与 history 等价，且已经
      if (snapshotPendingFor === sessionId) {
        // 有缓存时保持 loaded:cached（本地内容已可看），不要降级成 requested
        if (!sessionState.cacheDisplay) {
          sessionState.historyState = subOk ? 'requested' : 'sub-failed';
        }
        scheduleHistoryFallback(sessionId);
      } else {
        const histOk = client.requestHistory(sessionId);
        scheduleHistoryRetry(sessionId);
        if (!subOk || !histOk) {
          // 连接/E2EE 未就绪（如后台恢复中）：稍后重试，避免会话页空白。
          setTimeout(function () {
            if (sessionState.sessionId !== sessionId || state.connection !== 'connected') return;
            client.subscribe(sessionId);
            if (!sessionState.cacheDisplay) {
              sessionState.rowsAgg = protocol.newAggregator();
              sessionState.rows = [];
            }
            client.requestHistory(sessionId);
          }, 800);
        }
      }
      // Session summaries are the authoritative fallback when the subscription
      const sessionsFresh = state.lastSessionsFrame && state.lastSessionsFrame.at
        && Date.now() - Number(state.lastSessionsFrame.at) < 10000;
      if (state.connection === 'connected' && !sessionsFresh) {
        safeRequest(client.requestSessions(), uiText('会话列表'), 'sessions');
      }
      scheduleSessionBootstrap(sessionId, undefined, false);
      // Context/fleet projections load only when their tab becomes visible.
      if (contextActive) refreshContextDashboard(true);
      if (fleetActive) refreshContextFleet(true);
      // 新会话已运行且面板可见：立即恢复 2.5s 自动刷新（旧会话 timer 已清）。
      syncContextPolling();
      syncFleetPolling();
    },

    /** 乐观回显：发送后立即本地插入用户行（对齐桌面端即时可见），回显到达时合并 */
    appendLocalUserRow: function (text, images, attachments) {
      // 必须先提升缓存行：openSession 恢复缓存时只填了 sessionState.rows，
      promoteCachedRows();
      if (!sessionState.rowsAgg) sessionState.rowsAgg = protocol.newAggregator();
      sessionState.rowsAgg.rows.push({
        kind: 'user',
        key: 'local-' + Date.now(),
        title: uiText('你'),
        text: text || '',
        images: images || [],
        attachments: attachments || [],
        pending: true,
        seq: 9e9
      });
      sessionState.rows = sessionState.rowsAgg.rows.slice();
      emit();
    },

    closeSession: function () {
      clearSessionDetailsBootstrap();
      clearSessionStatsBootstrap();
      clearStatsRetry();
      if (sessionBootstrapTimer) { clearTimeout(sessionBootstrapTimer); sessionBootstrapTimer = null; }
      if (sessionState.sessionId) client.subscribe(null);
      sessionState.cacheDisplay = false;
      sessionState.sessionId = null;
      sessionState.rowsAgg = null;
      sessionState.rows = [];
      sessionState.trajectory = [];
      sessionState.stats = null;
      sessionState.turnUsage = {};
      sessionState.contextDashboard = createContextDashboardState();
      sessionState.contextFleet = createContextFleetState();
      contextActive = false;
      fleetActive = false;
      stopContextPolling();
      trajectoryDirty = true; trajectoryActive = false;
      setRawBuffer([]);
      runCueWatermark = -1;
      sessionState.runStartMs = null;
      sessionState.runCues = [];
      emit();
    },

    /** 开始新会话：先在网关创建会话，再订阅并打开。 */
    createAndOpenSession: function (workspaceId, agentPreset) {
      const self = this;
      const wsId = workspaceId === undefined ? state.currentWorkspaceId : workspaceId;
      // 乐观创建：立即进入本地创建态（秒开会话页），真实创建在后台进行
      sessionState.creating = true;
      trajectoryDirty = true; trajectoryActive = false;
      sessionState.creatingWorkspaceId = wsId;
      sessionState.creatingAgentPreset = agentPreset || null;
      sessionState.agentPreset = agentPreset || null;
      sessionState.sessionId = null;
      sessionState.rowsAgg = protocol.newAggregator();
      sessionState.rows = [];
      sessionState.trajectory = [];
      sessionState.contextDashboard = createContextDashboardState();
      sessionState.contextFleet = createContextFleetState();
      stopContextPolling();
      sessionState.historyState = 'creating';
      sessionState.historyError = '';
      sessionState.cacheDisplay = false;
      emit();
      const attempt = function (n) {
        return client.createSession(wsId, agentPreset).then(function (sessionId) {
          sessionState.creating = false;
          self.openSession(sessionId, '', agentPreset || null);
          return sessionId;
        }).catch(function (err) {
          if (n < 3) {
            return new Promise(function (r) { setTimeout(r, 800); }).then(function () { return attempt(n + 1); });
          }
          throw err;
        });
      };
      return attempt(1).catch(function (err) {
        sessionState.creating = false;
        sessionState.historyState = 'error:create';
        sessionState.historyError = uiText('创建会话失败：') + (err && err.message ? err.message : uiText('未知错误'));
        emit();
        throw err;
      });
    },

    retryCreateSession: function () {
      const wsId = sessionState.creatingWorkspaceId === undefined ? state.currentWorkspaceId : sessionState.creatingWorkspaceId;
      return this.createAndOpenSession(wsId, sessionState.creatingAgentPreset || undefined);
    },

    retryHistory: function () {
      const id = sessionState.sessionId;
      if (!id || state.connection !== 'connected') return;
      resetHistoryPaging();
      sessionState.cacheDisplay = false;
      sessionState.historyError = '';
      sessionState.historyState = 'requested';
      sessionState.rowsAgg = protocol.newAggregator();
      sessionState.rows = [];
      client.subscribe(id);
      client.requestHistory(id);
      scheduleHistoryRetry(id);
      emit();
    },

    loadOlderHistory: function () {
      return requestOlderHistory();
    },

    getTurnOutline: function (sessionId) {
      const cached = turnOutlineCache.get(sessionCacheKey(sessionId), value =>
        value && Array.isArray(value.items) ? value : null);
      return cached ? cached.items.map(item => Object.assign({}, item)) : [];
    },

    warmSessionCache: function (sessionId, isCurrent) {
      const scope = activeCacheScope();
      if (!scope || !sessionId || sessionId === sessionState.sessionId) return Promise.resolve(false);
      return sessionCache.warm(scope + '::' + sessionId, cached => normalizeSessionCache(sessionId, cached),
        () => activeCacheScope() === scope && (!isCurrent || isCurrent()));
    },

    saveTurnOutline: function (sessionId, items) {
      if (!sessionId || !Array.isArray(items) || !items.length) return;
      turnOutlineCache.set(sessionCacheKey(sessionId), { items: items.map(item => Object.assign({}, item)) }, { delayMs: 500 });
    },

    clearLocalCaches: function () {
      sessionViewCache.clear();
      sessionCache.clear();
      historyPageCache.clear();
      turnOutlineCache.clear();
      contextPanelCache.clear();
      homeCache.clear();
    },

    setTrajectoryActive: function (active) {
      trajectoryActive = active === true;
      if (trajectoryActive) refreshTrajectory();
      else if (trajectoryRefreshTimer) { clearTimeout(trajectoryRefreshTimer); trajectoryRefreshTimer = null; }
    },

    /** 上下文分段可见性：切入「上下文」时立即拉一次；离开后停止自动刷新。 */
    setContextActive: function (active) {
      const next = active === true;
      const changed = contextActive !== next;
      contextActive = next;
      if (next && changed) refreshContextDashboard(true);
      // 可见且运行中 → 开 2.5s 轮询；切走/停止 → 清 timer。
      syncContextPolling();
    },

    /** 手动/进入 tab 刷新上下文面板。 */
    refreshContextDashboard: function () {
      return refreshContextDashboard(true);
    },

    /** 编队分段可见性：切入「编队」时立即拉一次；离开后停止自动刷新。 */
    setFleetActive: function (active) {
      const next = active === true;
      const changed = fleetActive !== next;
      fleetActive = next;
      if (next && changed) refreshContextFleet(true);
      syncFleetPolling();
    },

    /** 手动/进入 tab 刷新编队面板。 */
    refreshContextFleet: function () {
      return refreshContextFleet(true);
    },

    updateSearch: function (query) {
      state.searchQuery = query;
      if (!query) {
        state.searchResults = null;
        emit();
        return;
      }
      safeRequest(client.searchSessions(query));
    },

    setCurrentWorkspace: function (workspaceId) {
      // null is an explicit selection, not the default-workspace fallback.
      state.isUngroupedWorkspaceSelected = workspaceId == null;
      state.currentWorkspaceId = workspaceId == null ? null : workspaceId;
      saveHomeCache();
      emit();
    },

    /** 拉取自动化任务目录（页面 onShow / 下拉刷新时调用）。 */
    refreshScheduledTasks: function () {
      refreshScheduledTasks();
    },

    /** 更新自动化任务（标题/内容/执行时间）。成功返回 requestId。 */
    updateScheduledTask: function (task, title, prompt, change) {
      return updateScheduledTask(task, title, prompt, change);
    },

    /** 删除自动化任务及其投递记录。成功返回 requestId。 */
    deleteScheduledTask: function (task) {
      return deleteScheduledTask(task);
    },

    /** 选择模型（本地乐观更新 + 主机回执校准）。 */
    selectModel: function (sessionId, provider, model, reasoningEffort) {
      return selectModel(sessionId, provider, model, reasoningEffort);
    },

    mutateGoal: function (kind, objective) {
      const goal = sessionState.goal && sessionState.goal.goal;
      if (!sessionState.sessionId || !goal || sessionState.goalMutation) return Promise.resolve(false);
      const ref = { id: goal.id, revision: goal.revision };
      sessionState.goalMutation = kind;
      emit();
      const request = kind === 'goal-edit'
        ? client.editGoal(sessionState.sessionId, ref, objective)
        : client.updateGoalState(kind, sessionState.sessionId, ref);
      return Promise.resolve(request).catch(function (err) {
        sessionState.goalMutation = '';
        emit();
        throw err;
      });
    },

    /** 拉取插件目录（插件页 onShow / 刷新按钮）。 */
    pluginInstaller: pluginInstaller,

    refreshPlugins: function () {
      refreshPlugins();
    },

    /** 启用/停用插件 bundle 或单个组件条目。 */
    setPluginEnabled: function (name, enabled, entryId) {
      return setPluginEnabled(name, enabled, entryId);
    },

    clearNotice: function () {
      state.notice = null;
      emit();
    }
  };
}

// 单例
const store = createStore();
module.exports = store;
module.exports.PENDING_KIND = PENDING_KIND;
module.exports.STORAGE_KEYS = STORAGE_KEYS;
