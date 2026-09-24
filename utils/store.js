// 全局状态仓库：持有 Gateway 连接、工作区/会话列表、当前会话投影与待处理
// 人类交互请求（question / approval）。页面通过 subscribe(listener) 订阅，
// 在 onShow/onHide 时注册/注销，与 iOS AppStore 的职责对齐。

const { GatewayClient } = require('./gateway');
const protocol = require('./protocol');
const pairing = require('./pairing');
const hosts = require('./hosts');
const util = require('./util');

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
  const state = {
    connection: 'disconnected', // disconnected | connecting | connected | failed
    connectionMessage: null,
    paired: false,
    gatewayName: null,
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
    sessions: [],
    searchResults: null,
    searchQuery: '',

    host: null,
    defaults: null,
    defaultModel: null,
    agentPresets: null,
    modelCatalog: null,

    notice: null
  };

  // 当前会话工作区（仅会话页读写）
  const sessionState = {
    sessionId: null,
    rowsAgg: null,
    rows: [],
    trajectory: [],
    running: false,
    historyFormatVersion: null,
    hasMoreHistory: false,
    nextBeforeSeq: null,
    title: '',
    agentPreset: null,
    pendingQuestion: null,
    pendingApproval: null,
    questionStatus: 'idle',
    approvalStatus: 'idle',
    stats: null,
    permission: null,
    permissionOptions: null,
    selection: null
  };

  const client = new GatewayClient({
    onState: function (status, message) {
      state.connection = status;
      state.connectionMessage = message;
      if (status === 'connected') {
        bootstrap();
      } else if (status === 'disconnected') {
        state.paired = false;
      }
      emit();
    },
    onPaired: function (frame) {
      state.paired = true;
      acceptIdentity(frame);
    },
    onFrame: function (frame) {
      handleFrame(frame);
    },
    onNotice: function (text, isError) {
      state.notice = { text: text, isError: !!isError, at: Date.now() };
      emit();
    }
  });

  function emit() {
    const snapshot = { app: state, session: sessionState };
    listeners.forEach(function (listener) {
      try { listener(snapshot); } catch (e) { /* 页面已卸载等 */ }
    });
  }

  function bootstrap() {
    safeRequest(client.requestWorkspaces());
    safeRequest(client.requestSessions());
    safeRequest(client.requestHost());
    safeRequest(client.requestDefaults());
    safeRequest(client.requestDefaultModel());
    safeRequest(client.requestAgentPresets());
    if (sessionState.sessionId) {
      client.subscribe(sessionState.sessionId);
    }
  }

  function safeRequest(promise) {
    if (promise && promise.catch) {
      promise.catch(function () { /* 失败态由 error 帧或连接状态体现 */ });
    }
  }

  // ---------- 帧路由 ----------

  function handleFrame(frame) {
    switch (frame.kind) {
      case 'hello':
        acceptIdentity(frame);
        state.gatewayName = frame.gatewayName || state.gatewayName;
        state.clientCount = frame.clients;
        emit();
        return;
      case 'workspaces':
        state.workspaces = frame.items || [];
        state.archivedSessionIds = frame.archivedSessionIds || [];
        if (!state.currentWorkspaceId && state.workspaces.length) {
          state.currentWorkspaceId = state.workspaces[0].workspaceId;
        }
        emit();
        return;
      case 'workspace-create':
        safeRequest(client.requestWorkspaces());
        return;
      case 'sessions':
        state.sessions = (frame.items || []).map(mapSessionSummary);
        emit();
        return;
      case 'search':
        state.searchResults = (frame.items || []);
        emit();
        return;
      case 'host':
        state.host = {
          version: frame.version,
          cwd: frame.cwd,
          provider: frame.provider,
          model: frame.model,
          attachedSessions: frame.attachedSessions,
          canOpenPath: frame.canOpenPath
        };
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

    // 会话域
    if (frame.sessionId && frame.sessionId === sessionState.sessionId) {
      handleSessionFrame(frame);
    }
  }

  function handleSessionFrame(frame) {
    switch (frame.kind) {
      case 'session-agent-preset':
      case 'session-agent-preset-updated':
        // 会话级 Agent 预设当前值；锁定状态单向生效
        if (frame.agentPreset !== undefined && frame.agentPreset !== null) {
          sessionState.agentPreset = frame.agentPreset;
          emit();
        }
        return;
      case 'event': {
        const evs = frame.events || [];
        if (typeof frame.seq === 'number' && frame.event) {
          const raw = {
            type: frame.event.type || 'unknown',
            seq: frame.seq,
            time: frame.time || Date.now() / 1000,
            data: frame.event.data || {}
          };
          ingestEvents([raw]);
          refreshStatsSoon();
        } else if (evs.length) {
          ingestEvents(evs);
        }
        // 运行状态：turn/start 点亮，turn/end 熄灭（对齐 dsh-mobile turn 计数）
        (evs.length ? evs : []).concat(frame.event ? [frame] : []).forEach((raw) => {
          const t = raw.event ? raw.event.type : raw.type;
          if (t === 'turn/start') sessionState.running = true;
          if (t === 'turn/end') sessionState.running = false;
        });
        emit();
        return;
      }
      case 'history': {
        const events = frame.events || [];
        if (frame.resetRequired) {
          sessionState.rowsAgg = protocol.newAggregator();
        }
        const prepend = !!frame.beforeSeqPlaceholder || sessionState.rows.length > 0;
        ingestEvents(events, prepend);
        sessionState.hasMoreHistory = frame.hasMore === true;
        sessionState.nextBeforeSeq = frame.nextBeforeSeq;
        if (frame.historyFormatVersion) sessionState.historyFormatVersion = frame.historyFormatVersion;
        emit();
        return;
      }
      case 'session-snapshot': {
        sessionState.historyFormatVersion = frame.historyFormatVersion || sessionState.historyFormatVersion;
        if (frame.cursor !== undefined) sessionState.nextBeforeSeq = frame.cursor;
        if (frame.replace) {
          sessionState.rowsAgg = protocol.newAggregator();
          sessionState.rows = [];
        }
        ingestEvents(frame.events || []);
        emit();
        return;
      }
      case 'sent':
        sessionState.running = true;
        emit();
        return;
      case 'session-title-updated':
      case 'title':
        if (frame.title) sessionState.title = frame.title;
        emit();
        return;
      case 'session-cancelled':
        sessionState.running = false;
        safeRequest(client.requestSessionStats(sessionState.sessionId));
        safeRequest(client.requestContextUsage(sessionState.sessionId));
        emit();
        return;
      case 'session-stats':
        sessionState.stats = {
          stats: frame.sessionStats || null,
          tokenUsage: frame.tokenUsage || null,
          pressure: frame.contextPressure || null
        };
        emit();
        return;
      case 'context-usage':
        sessionState.stats = sessionState.stats || {};
        sessionState.stats.tokenUsage = frame.tokenUsage || sessionState.stats.tokenUsage;
        sessionState.stats.pressure = frame.contextPressure || sessionState.stats.pressure;
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
        sessionState.selection = frame.selected || sessionState.selection;
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
        state.notice = { text: frame.message || frame.code || '请求失败', isError: true, at: Date.now() };
        emit();
        return;
      default:
        return;
    }
  }

  function ingestEvents(rawEvents, prepend) {
    if (!sessionState.rowsAgg) sessionState.rowsAgg = protocol.newAggregator();
    const sessionId = sessionState.sessionId;
    const sorted = rawEvents.slice().sort(function (a, b) { return a.seq - b.seq; });
    if (prepend) {
      // 加载更早历史：整体重建，保证折叠关系正确（数据量在移动端可接受）。
      rebuildWithMore(sorted);
      return;
    }
    sorted.forEach(function (raw) {
      const normalized = protocol.normalizeRawEvent(raw, sessionId);
      protocol.applyEvent(sessionState.rowsAgg, normalized);
    });
    sessionState.rows = sessionState.rowsAgg.rows.slice();
    sessionState.trajectory = protocol.buildTrajectory(allRawEvents(sorted, true), sessionId);
  }

  // 保留原始事件缓冲以重建轨迹
  let rawBuffer = [];
  function allRawEvents(latest, append) {
    if (append) {
      rawBuffer = rawBuffer.concat(latest.filter(function (e) {
        return !rawBuffer.some(function (existing) { return existing.seq === e.seq; });
      }));
      rawBuffer.sort(function (a, b) { return a.seq - b.seq; });
    }
    return rawBuffer;
  }

  function rebuildWithMore(older) {
    const merged = {};
    rawBuffer.forEach(function (e) { merged[e.seq] = e; });
    older.forEach(function (e) { merged[e.seq] = e; });
    rawBuffer = Object.keys(merged).map(function (k) { return merged[k]; })
      .sort(function (a, b) { return a.seq - b.seq; });
    sessionState.rows = protocol.buildRows(rawBuffer, sessionState.sessionId);
    sessionState.rowsAgg = protocol.newAggregator();
    rawBuffer.forEach(function (raw) {
      protocol.applyEvent(sessionState.rowsAgg, protocol.normalizeRawEvent(raw, sessionState.sessionId));
    });
    sessionState.rows = sessionState.rowsAgg.rows.slice();
    sessionState.trajectory = protocol.buildTrajectory(rawBuffer, sessionState.sessionId);
  }

  let statsTimer = null;
  function refreshStatsSoon() {
    if (statsTimer) return;
    statsTimer = setTimeout(function () {
      statsTimer = null;
      if (sessionState.sessionId) {
        safeRequest(client.requestSessionStats(sessionState.sessionId));
        safeRequest(client.requestContextUsage(sessionState.sessionId));
      }
    }, 800);
  }

  function mapSessionSummary(item) {
    const projections = item.projections || {};
    const values = projections.values || {};
    return {
      sessionId: item.sessionId,
      updatedAt: item.updatedAt ? util.eventDateMs(item.updatedAt) : Date.now(),
      running: item.running === true,
      blank: item.blank === true,
      cwd: item.cwd || null,
      agentPreset: item.agentPreset || null,
      title: values.title || null
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
    if (frameGatewayId) {
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
        gatewayName: frame.gatewayName || hostLabelFromEndpoint(state.endpoint) || '新主机',
        endpoints: state.endpoint ? [state.endpoint] : [],
        preferredEndpoint: state.endpoint
      });
    }
    if (frameGatewayId) profile.gatewayId = frameGatewayId;
    const name = String(frame.gatewayName || '').trim();
    if (name) profile.gatewayName = frame.gatewayName;
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
    upsertProfile(profile);
    if (isPending || state.activeID !== profile.id) {
      state.activeID = profile.id;
      hosts.setActiveID(profile.id);
    }
    pendingProfile = null;
    emit();
  }

  /** 建立配对连接：复用同身份档案，否则新建（iOS pair 对齐）。 */
  function beginPairing(endpoint, code, payload) {
    const normalized = payload
      ? hosts.normalizeEndpoints(payload.publicUrl, payload.endpoints)
      : [hosts.normalizeEndpoint(endpoint)].filter(Boolean);
    if (!normalized || !normalized.length) {
      return { ok: false, error: hosts.ErrorText.address };
    }
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
    if (!profile) {
      profile = hosts.newProfile({
        gatewayId: gid,
        gatewayName: (payload && payload.gatewayName) || hostPart || '新主机',
        endpoints: normalized,
        preferredEndpoint: normalized[0],
        deviceKind: hosts.isLocalHost(hostPart) ? 'desktopcomputer' : 'server.rack'
      });
    }
    // 重新扫码代表用户明确认可本次地址集合；publicUrl 优先（iOS pair 对齐）。
    profile.endpoints = normalized;
    profile.preferredEndpoint = normalized[0];
    if (payload && String(payload.gatewayName || '').trim()) profile.gatewayName = payload.gatewayName;
    // v3 relay 模式：记录中继元信息，重连时不再依赖 Bearer token（由 fnOS 连接器注入）。
    if (payload && payload.mode === 'relay') {
      profile.relay = true;
      profile.relayAgentPubKey = payload.agentPubKey || null;
    } else if (!payload || payload.mode !== 'relay') {
      profile.relay = false;
      profile.relayAgentPubKey = null;
    }
    pendingProfile = profile;
    state.endpoint = normalized[0];
    state.gatewayName = hosts.displayName(profile);
    state.gatewayId = profile.gatewayId;
    if (payload && payload.mode === 'relay') {
      client.connect(normalized[0], {
        relay: { nodeId: payload.nodeId || profile.gatewayId, agentPubKey: payload.agentPubKey }
      });
    } else {
      client.connect(normalized[0], { pairingCode: code });
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
      const profile = hosts.newProfile({
        gatewayName: hostPart || '原有主机',
        endpoints: [endpoint],
        preferredEndpoint: endpoint,
        deviceKind: hosts.isLocalHost(hostPart) ? 'desktopcomputer' : 'server.rack'
      });
      hosts.saveCredential(profile.id, endpoint, token);
      hosts.saveProfiles([profile]);
      hosts.setActiveID(profile.id);
      wx.removeStorageSync(STORAGE_KEYS.endpoint);
      wx.removeStorageSync(STORAGE_KEYS.token);
    } catch (e) { /* 忽略 */ }
  }

  /** 连接激活档案（凭据按档案 ID 读取）。 */
  function connectActiveProfile() {
    const profile = getProfile(state.activeID);
    if (!profile) return false;
    const cred = hosts.loadCredential(profile.id);
    const endpoints = hosts.connectionEndpoints(profile);
    const endpoint = endpoints[0] || (cred && cred.endpoint) || null;
    if (!endpoint) {
      state.connection = 'disconnected';
      state.connectionMessage = '缺少连接凭据，请重新扫码配对';
      emit();
      return false;
    }
    state.endpoint = endpoint;
    state.gatewayName = hosts.displayName(profile);
    state.gatewayId = profile.gatewayId;
    // relay 档案：凭据由 fnOS 连接器持有，小程序端只需 E2EE 元信息
    if (profile.relay && profile.relayAgentPubKey) {
      client.lastToken = null;
      client.connect(endpoint, {
        relay: { nodeId: profile.gatewayId, agentPubKey: profile.relayAgentPubKey }
      });
      return true;
    }
    if (!cred || !cred.token) {
      state.connection = 'disconnected';
      state.connectionMessage = '缺少连接凭据，请重新扫码配对';
      emit();
      return false;
    }
    client.lastToken = cred.token;
    client.connect(endpoint, { token: cred.token });
    return true;
  }

  /** 切换/删除主机时清空上一台主机的业务数据。 */
  function resetDataState() {
    state.workspaces = [];
    state.archivedSessionIds = [];
    state.currentWorkspaceId = null;
    state.sessions = [];
    state.searchQuery = '';
    state.searchResults = null;
    state.host = null;
    state.clientCount = null;
    state.defaultModel = null;
    state.agentPresets = null;
    state.modelCatalog = null;
    state.gatewayName = null;
    state.gatewayId = null;
    state.paired = false;
    sessionState.sessionId = null;
    sessionState.rowsAgg = null;
    sessionState.rows = [];
    sessionState.trajectory = [];
    sessionState.title = '';
    sessionState.agentPreset = null;
    sessionState.pendingQuestion = null;
    sessionState.pendingApproval = null;
    sessionState.questionStatus = 'idle';
    sessionState.approvalStatus = 'idle';
    sessionState.stats = null;
    rawBuffer = [];
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

  // ---------- 在线探测（iOS refreshPresence 对齐） ----------

  let probeClients = [];
  let probeToken = 0;

  function probeProfile(profile) {
    const cred = hosts.loadCredential(profile.id);
    if (!cred || !cred.token) return Promise.resolve(false);
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
        probeClient.connect(endpoint, { token: cred.token, probe: true });
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
        if (state.activeID) {
          hosts.setActiveID(state.activeID);
          const scopedDefaults = loadDefaults();
          if (scopedDefaults) state.defaults = scopedDefaults;
          connectActiveProfile();
        }
      } catch (e) { /* 首次启动无凭据 */ }
    },

    appDidBecomeActive: function () {
      if (state.connection !== 'connected' && state.activeID) {
        const activeProfile = getProfile(state.activeID);
        if (activeProfile && activeProfile.relay && activeProfile.relayAgentPubKey && state.endpoint) {
          client.connect(state.endpoint, {
            relay: { nodeId: activeProfile.gatewayId, agentPubKey: activeProfile.relayAgentPubKey }
          });
        } else if (client.lastToken && state.endpoint) {
          client.connect(state.endpoint, { token: client.lastToken });
        } else {
          connectActiveProfile();
        }
      }
    },

    appDidEnterBackground: function () {
      // 小程序无真正后台 WebSocket 保活；交由平台管理，仅记录状态。
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
      // v3 中继端点每次换节点/重新配对都会变化，且 E2EE 的 agentPubKey
      // 在 AgentHello 阶段已做密码学验签，端点白名单对它只会阻碍重配对；
      // 因此白名单仅对 v2 直连地址生效。
      if (payload.mode !== 'relay' && !isTrustedEndpoint(payload.publicUrl)) {
        return { ok: false, error: '地址未经此主机确认，请重新扫码添加地址。' };
      }
      return beginPairing(payload.publicUrl, payload.pairingCode, payload);
    },

    pairManual: function (endpoint, pairingCode) {
      const normalized = String(endpoint || '').trim().replace(/\/+$/, '');
      if (!/^wss?:\/\//.test(normalized)) {
        return { ok: false, error: '请输入以 ws:// 或 wss:// 开头的 WebSocket 地址' };
      }
      const code = String(pairingCode || '').trim();
      if (!code || /\s/.test(code)) {
        return { ok: false, error: '一次性配对码无效' };
      }
      // 手动输入只用于 v2 直连（v3 走扫码载荷），保留白名单校验。
      if (!isTrustedEndpoint(normalized)) {
        return { ok: false, error: '地址未经此主机确认，请重新扫码添加地址。' };
      }
      return beginPairing(normalized, code, null);
    },

    reconnectWithSaved: function () {
      return connectActiveProfile();
    },

    forgetDevice: function () {
      if (state.activeID) removeHosts([state.activeID]);
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

    /** 探测全部主机在线状态（更新 state.onlineIDs）。 */
    refreshHostPresence: function () {
      return refreshHostPresence();
    },

    stopHostProbes: function () {
      stopHostProbes();
    },

    /** 打开会话：重置会话投影并订阅。 */
    openSession: function (sessionId, title, agentPreset) {
      client.subscribe(sessionId);
      sessionState.sessionId = sessionId;
      sessionState.rowsAgg = protocol.newAggregator();
      sessionState.rows = [];
      sessionState.trajectory = [];
      sessionState.title = title || '';
      sessionState.agentPreset = agentPreset || null;
      sessionState.pendingQuestion = null;
      sessionState.pendingApproval = null;
      sessionState.stats = null;
      rawBuffer = [];
      emit();
      client.requestHistory(sessionId);
      safeRequest(client.requestSessionStats(sessionId));
      safeRequest(client.requestContextUsage(sessionId));
      safeRequest(client.requestPermissionOptions(sessionId));
      safeRequest(client.requestModels(sessionId));
    },

    closeSession: function () {
      if (sessionState.sessionId) client.subscribe(null);
      sessionState.sessionId = null;
      sessionState.rowsAgg = null;
      sessionState.rows = [];
      sessionState.trajectory = [];
      rawBuffer = [];
      emit();
    },

    /** 开始新会话：先在网关创建会话，再订阅并打开。 */
    createAndOpenSession: function (workspaceId) {
      const self = this;
      return client.createSession(workspaceId || state.currentWorkspaceId).then(function (sessionId) {
        self.openSession(sessionId, '', null);
        return sessionId;
      });
    },

    loadOlderHistory: function () {
      if (!sessionState.sessionId || !sessionState.hasMoreHistory) return;
      client.requestHistory(
        sessionState.sessionId,
        sessionState.nextBeforeSeq,
        sessionState.historyFormatVersion
      );
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
      state.currentWorkspaceId = workspaceId;
      emit();
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
