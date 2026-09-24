// Mobile Gateway WebSocket 客户端。
// 传输与连接策略对齐 iOS GatewayClient：配对握手（Sec-WebSocket-Protocol:
// dsh-mobile-v1, dsh-pair.<code>）、长期凭据（Authorization: Bearer）、
// 断线重连、请求/响应路由（requestType/rpcId 关联）。
//
// 小程序差异：wx.connectSocket 的 header/protocols 支持随基础库版本变化，
// 真机以 wss 为主；开发工具需勾选「不校验合法域名」才能连 ws:// 局域网地址。

const util = require('./util');
const { ClientSession } = require('./relay-e2ee');

/** Uint8Array → 独立 ArrayBuffer（wx.send 要 ArrayBuffer）。 */
function toArrayBuffer(u8) {
  return u8.slice().buffer;
}

const CHANNEL = 'miniprogram';
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const REQUEST_TIMEOUT = 20000;
const SESSION_CREATE_TIMEOUT = 15000;

class GatewayClient {
  constructor(callbacks) {
    this.cb = callbacks || {};
    this.socketTask = null;
    this.state = 'disconnected'; // disconnected | connecting | connected | failed
    this.endpoint = null;
    this.pairingCode = null;
    this.wantsConnection = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.timeoutTimer = null;
    this.pendingRequests = {}; // key → { resolve, reject, timer }
    this.sessionCreations = {}; // requestId → { resolve, reject, timer }
    this.deviceId = this.loadOrCreateDeviceId();
    this.probeOnly = false; // 主机在线探测：只验 hello，不重连、不发业务请求
    this.relaySession = null; // v3 relay 模式的 E2EE 会话
    this.relayMeta = null;    // { nodeId, agentPubKey }
  }

  // ---------- 状态 ----------

  setState(state, message) {
    this.state = state;
    if (this.cb.onState) this.cb.onState(state, message || null);
  }

  // ---------- 设备标识 ----------

  loadOrCreateDeviceId() {
    try {
      let id = wx.getStorageSync('dsh_device_id');
      if (!id) {
        id = util.uuid();
        wx.setStorageSync('dsh_device_id', id);
      }
      return id;
    } catch (e) {
      return util.uuid();
    }
  }

  // ---------- 连接 ----------

  /** pairingCode 非空表示一次性配对握手；否则使用已保存的 Bearer 凭据。 */
  connect(endpoint, options) {
    const opts = options || {};
    this.disconnect({ keepWant: false });
    this.probeOnly = !!opts.probe;
    if (!/^wss?:\/\//.test(endpoint || '')) {
      this.setState('failed', '二维码中的 publicUrl 不是有效的 ws:// 或 wss:// 地址');
      return;
    }
    this.wantsConnection = true;
    this.endpoint = endpoint;
    this.pairingCode = opts.pairingCode || null;
    this.relayMeta = opts.relay || null;
    this.relaySession = null;
    this.setState('connecting');

    const header = {
      'X-DSH-Channel': CHANNEL,
      'X-DSH-Device-ID': this.deviceId
    };
    const protocols = [];
    
    // 正确方式：子协议通过 protocols 数组传递
    // 1. 主协议 dsh-mobile-v1 必须加
    protocols.push('dsh-mobile-v1');
    
    // 2. 配对码时额外添加 dsh-pair. 子协议
    if (this.pairingCode) {
      protocols.push('dsh-pair.' + this.pairingCode);
    }
    
    // 3. 已保存 token 时添加 Authorization
    if (opts.token) {
      header['Authorization'] = 'Bearer ' + opts.token;
    }

    const self = this;
    try {
      this.socketTask = wx.connectSocket({
        url: endpoint,
        header: header,
        protocols: protocols,  // 务必传递完整的 protocols 数组
        fail: function (err) {
          self.setState('failed', (err && err.errMsg) || '无法建立 WebSocket 连接');
          self.scheduleReconnect();
        }
      });
    } catch (e) {
      this.setState('failed', e.message || '无法建立 WebSocket 连接');
      return;
    }

    this.socketTask.onOpen(function () {
      self.reconnectAttempts = 0;
      if (self.relayMeta) {
        // relay 模式：先完成 E2EE 握手，AgentHello 验签通过后才置 connected
        self.relaySession = new ClientSession(self.relayMeta.nodeId, self.relayMeta.agentPubKey);
        try {
          self.socketTask.send({ data: toArrayBuffer(self.relaySession.hello) });
        } catch (e) {
          self.handleTransportFailure('E2EE 握手发送失败');
        }
        return;
      }
      self.setState('connected');
    });
    this.socketTask.onMessage(function (res) {
      if (self.relayMeta) {
        self.handleRelayMessage(res.data);
        return;
      }
      self.handleFrame(res.data);
    });
    this.socketTask.onError(function (err) {
      self.handleTransportFailure((err && err.errMsg) || '连接发生错误');
    });
    this.socketTask.onClose(function () {
      if (self.state === 'connected' || self.state === 'connecting') {
        self.handleTransportFailure('连接已关闭');
      }
    });

    this.startConnectionTimeout();
  }

  startConnectionTimeout() {
    const self = this;
    this.clearConnectionTimeout();
    this.timeoutTimer = setTimeout(function () {
      if (self.state === 'connecting') {
        self.handleTransportFailure('连接超时');
      }
    }, REQUEST_TIMEOUT);
  }

  clearConnectionTimeout() {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  handleTransportFailure(message) {
    this.clearConnectionTimeout();
    const wasDeliberate = !this.wantsConnection;
    const socket = this.socketTask;
    this.socketTask = null;
    if (socket) {
      try { socket.close({}); } catch (e) { /* 忽略 */ }
    }
    this.failAllPending(message);
    if (wasDeliberate) {
      this.setState('disconnected');
      return;
    }
    // 配对码是一次性凭据，失败后不能拿旧码静默重试。
    if (this.pairingCode) {
      this.pairingCode = null;
      this.wantsConnection = false;
      this.setState('failed', message + '，配对码已失效，请重新扫码');
      return;
    }
    this.setState('failed', message);
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (!this.wantsConnection || this.reconnectTimer || this.probeOnly) return;
    const self = this;
    this.reconnectAttempts += 1;
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY
    );
    this.reconnectTimer = setTimeout(function () {
      self.reconnectTimer = null;
      if (self.wantsConnection && self.endpoint) {
        self.connect(self.endpoint, { token: self.lastToken || null });
      }
    }, delay);
  }

  disconnect(options) {
    const keepWant = options && options.keepWant;
    this.wantsConnection = !!keepWant;
    this.clearConnectionTimeout();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socketTask;
    this.socketTask = null;
    if (socket) {
      try { socket.close({ code: 1000, reason: 'normal' }); } catch (e) { /* 忽略 */ }
    }
    this.pairingCode = null;
    this.relaySession = null;
    this.relayMeta = null;
    this.failAllPending('连接已断开');
    this.setState('disconnected');
  }

  failAllPending(message) {
    const pending = this.pendingRequests;
    this.pendingRequests = {};
    Object.keys(pending).forEach(function (key) {
      clearTimeout(pending[key].timer);
      pending[key].reject(new Error(message));
    });
    const creations = this.sessionCreations;
    this.sessionCreations = {};
    Object.keys(creations).forEach(function (key) {
      clearTimeout(creations[key].timer);
      creations[key].reject(new Error(message));
    });
  }

  // ---------- relay（E2EE） ----------

  /** relay 模式的二进制消息：握手包或密文帧。 */
  handleRelayMessage(data) {
    if (!(data instanceof ArrayBuffer)) return;
    const bytes = new Uint8Array(data);
    const session = this.relaySession;
    if (!session) return;
    if (!session.ready) {
      if (!session.acceptAgentHello(bytes)) {
        this.handleTransportFailure('E2EE 握手失败：agent 身份验签未通过，可能存在中间人，请重新扫码确认配对信息');
      } else {
        this.clearConnectionTimeout();
        this.setState('connected');
      }
      return;
    }
    const text = session.open(bytes);
    if (text === null) {
      this.handleTransportFailure('E2EE 解密失败，连接已终止');
      return;
    }
    this.handleFrame(text);
  }

  // ---------- 收发 ----------

  send(object) {
    if (!this.socketTask || this.state !== 'connected') {
      if (this.cb.onNotice) this.cb.onNotice('WebSocket 尚未连接', true);
      return false;
    }
    try {
      if (this.relayMeta) {
        if (!this.relaySession || !this.relaySession.ready) {
          if (this.cb.onNotice) this.cb.onNotice('E2EE 会话未就绪', true);
          return false;
        }
        this.socketTask.send({ data: toArrayBuffer(this.relaySession.seal(JSON.stringify(object))) });
        return true;
      }
      this.socketTask.send({ data: JSON.stringify(object) });
      return true;
    } catch (e) {
      this.handleTransportFailure(e.message || '发送失败');
      return false;
    }
  }

  handleFrame(data) {
    this.clearConnectionTimeout();
    let frame;
    try {
      frame = typeof data === 'string' ? JSON.parse(data) : JSON.parse(String(data));
    } catch (e) {
      if (this.cb.onFrameError) this.cb.onFrameError('decode-failed', e.message);
      return;
    }
    // v0.1.6 广播缺 kind 的实时事件在此补齐（与 GatewayWireDecoder 一致）。
    if (!frame.kind && typeof frame.sessionId === 'string' && typeof frame.seq === 'number' && frame.event) {
      frame.kind = 'event';
    }

    if (frame.kind === 'paired') {
      this.lastToken = frame.token || null;
      if (this.cb.onPaired) this.cb.onPaired(frame);
    }

    this.resolveCorrelated(frame);
    if (this.cb.onFrame) this.cb.onFrame(frame);
  }

  resolveCorrelated(frame) {
    // pong 关联到 ping
    if (frame.kind === 'pong') {
      const pendingPing = this.pendingRequests['type:ping'];
      if (pendingPing) {
        delete this.pendingRequests['type:ping'];
        clearTimeout(pendingPing.timer);
        pendingPing.resolve(frame);
      }
      return;
    }
    // 会话创建
    if (frame.kind === 'session-created' || (frame.kind === 'error' && frame.requestType === 'session-create')) {
      const pending = frame.requestId ? this.sessionCreations[frame.requestId] : null;
      if (pending) {
        delete this.sessionCreations[frame.requestId];
        clearTimeout(pending.timer);
        if (frame.kind === 'session-created' && frame.sessionId) {
          pending.resolve(frame.sessionId);
        } else {
          pending.reject(new Error(frame.message || '创建会话失败'));
        }
      }
      return;
    }
    // rpcId 关联（question / approval）
    if (frame.rpcId && (frame.kind === 'question-response' || frame.kind === 'approval-response')) {
      const pendingRpc = this.pendingRequests['rpc:' + frame.rpcId];
      if (pendingRpc) {
        delete this.pendingRequests['rpc:' + frame.rpcId];
        clearTimeout(pendingRpc.timer);
        pendingRpc.resolve(frame);
      }
      return;
    }
    // requestType 关联的控制请求
    if (frame.requestType && (frame.kind === frame.requestType || frame.kind === 'error')) {
      const pendingReq = this.pendingRequests['type:' + frame.requestType];
      if (pendingReq) {
        delete this.pendingRequests['type:' + frame.requestType];
        clearTimeout(pendingReq.timer);
        if (frame.kind === 'error') {
          pendingReq.reject(new Error(frame.message || frame.code || (frame.requestType + '-failed')));
        } else {
          pendingReq.resolve(frame);
        }
      }
    }
  }

  /** 发送并等待关联响应；同一 requestType 仅允许一个在途请求。 */
  request(object, options) {
    const opts = options || {};
    const self = this;
    return new Promise(function (resolve, reject) {
      if (!self.send(object)) {
        reject(new Error('WebSocket 尚未连接'));
        return;
      }
      if (opts.noAck) {
        resolve(null);
        return;
      }
      const key = (opts.rpcId ? 'rpc:' + opts.rpcId : 'type:' + (opts.matchType || object.type));
      const previous = self.pendingRequests[key];
      if (previous) {
        clearTimeout(previous.timer);
        previous.reject(new Error('已被新的同类请求取代'));
      }
      const timer = setTimeout(function () {
        delete self.pendingRequests[key];
        reject(new Error('请求超时：' + object.type));
      }, opts.timeout || REQUEST_TIMEOUT);
      self.pendingRequests[key] = { resolve: resolve, reject: reject, timer: timer };
    });
  }

  createSession(workspaceId) {
    const self = this;
    const requestId = util.uuid();
    return new Promise(function (resolve, reject) {
      const payload = { type: 'session-create', requestId: requestId };
      if (workspaceId) payload.workspaceId = workspaceId;
      if (!self.send(payload)) {
        reject(new Error('WebSocket 尚未连接'));
        return;
      }
      const timer = setTimeout(function () {
        delete self.sessionCreations[requestId];
        reject(new Error('创建会话超时'));
      }, SESSION_CREATE_TIMEOUT);
      self.sessionCreations[requestId] = { resolve: resolve, reject: reject, timer: timer };
    });
  }

  // ---------- 语义化请求 ----------

  ping() { return this.request({ type: 'ping' }, { matchType: 'ping' }); }
  requestWorkspaces() { return this.request({ type: 'workspaces' }); }
  requestSessions() { return this.request({ type: 'sessions' }); }
  requestHost() { return this.request({ type: 'host' }); }
  searchSessions(query) { return this.request({ type: 'search', query: query }); }

  requestDirectories(path) {
    const payload = { type: 'directories' };
    if (path) payload.path = path;
    return this.request(payload);
  }

  createDirectory(path, name) {
    return this.request({ type: 'directory-create', path: path, name: name });
  }

  createWorkspace(path) {
    return this.request({ type: 'workspace-create', path: path });
  }

  requestModels(sessionId) {
    const payload = { type: 'models' };
    if (sessionId) payload.sessionId = sessionId;
    return this.request(payload);
  }

  selectModel(sessionId, provider, model, reasoningEffort) {
    const payload = { type: 'select-model', sessionId: sessionId, provider: provider, model: model };
    if (reasoningEffort) payload.reasoningEffort = reasoningEffort;
    return this.request(payload);
  }

  requestPermissionOptions(sessionId) {
    const payload = { type: 'permission-options' };
    if (sessionId) payload.sessionId = sessionId;
    return this.request(payload);
  }

  setPermission(sessionId, name) {
    return this.request({ type: 'permission', sessionId: sessionId, name: name });
  }

  requestSessionStats(sessionId) {
    return this.request({ type: 'session-stats', sessionId: sessionId });
  }

  requestContextUsage(sessionId) {
    return this.request({ type: 'context-usage', sessionId: sessionId });
  }

  requestHistory(sessionId, beforeSeq, historyFormatVersion) {
    const payload = { type: 'history', sessionId: sessionId, maxMessages: 50 };
    if (beforeSeq !== undefined && beforeSeq !== null && beforeSeq >= 0 && historyFormatVersion) {
      payload.beforeSeq = beforeSeq;
      payload.historyFormatVersion = historyFormatVersion;
    }
    return this.send(payload);
  }

  requestAttachment(sessionId, attachmentId) {
    return this.request({ type: 'attachment', sessionId: sessionId, attachmentId: attachmentId });
  }

  subscribe(sessionId) {
    if (sessionId) {
      return this.send({ type: 'subscribe', sessionId: sessionId, assistantStream: true });
    }
    return this.send({ type: 'unsubscribe' });
  }

  archiveSession(sessionId) {
    return this.send({ type: 'session-archive', sessionId: sessionId });
  }

  renameSession(sessionId, title) {
    return this.send({ type: 'session-rename', sessionId: sessionId, title: title });
  }

  cancelSession(sessionId) {
    return this.send({ type: 'session-cancel', sessionId: sessionId });
  }

  /** images: [{ mediaType, data(base64), name }] */
  sendMessage(text, sessionId, workspaceId, images, mode) {
    const payload = {
      type: 'message',
      text: text,
      images: (images || []).map(function (img) {
        return { mediaType: img.mediaType, data: img.data, name: img.name || null };
      }),
      clientTimeZone: this.timeZone(),
      mode: mode || 'queue'
    };
    if (sessionId) payload.sessionId = sessionId;
    if (!sessionId && workspaceId) payload.workspaceId = workspaceId;
    return this.send(payload);
  }

  answerQuestion(rpcId, sessionId, answers) {
    return this.request({
      type: 'question-answer',
      rpcId: rpcId,
      sessionId: sessionId,
      answers: answers
    }, { rpcId: rpcId, timeout: REQUEST_TIMEOUT });
  }

  cancelQuestion(rpcId, sessionId) {
    return this.request({
      type: 'question-cancel',
      rpcId: rpcId,
      sessionId: sessionId
    }, { rpcId: rpcId });
  }

  respondToApproval(rpcId, sessionId, approvalId, outcome) {
    return this.request({
      type: 'approval-response',
      rpcId: rpcId,
      sessionId: sessionId,
      approvalId: approvalId,
      outcome: outcome // 'allowed-once' | 'rejected'
    }, { rpcId: rpcId });
  }

  // ---------- 部署默认配置 ----------

  requestAgentPresets() { return this.request({ type: 'agent-presets' }); }

  // 会话级 Agent 预设（对齐 dsh-mobile v1.6.0 SessionAgentPresetControl）
  requestSessionAgentPreset(sessionId) {
    return this.request({ type: 'session-agent-preset', sessionId: sessionId });
  }

  selectSessionAgentPreset(sessionId, agentPreset) {
    return this.request({ type: 'select-agent-preset', sessionId: sessionId, agentPreset: agentPreset });
  }
  requestDefaults() { return this.request({ type: 'defaults' }); }
  requestDefaultModel() { return this.request({ type: 'default-model' }); }

  saveDefaultModel(provider, model, reasoningEffort) {
    const payload = { type: 'save-default-model', provider: provider, model: model };
    if (reasoningEffort) payload.reasoningEffort = reasoningEffort;
    return this.request(payload);
  }

  setDefault(target, value) {
    return this.request({ type: 'set-default', target: target, value: value });
  }

  timeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
      return 'UTC';
    }
  }
}

module.exports = { GatewayClient, CHANNEL };
