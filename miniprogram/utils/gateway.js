const { t: uiText } = require('./ui-preferences');
// Mobile Gateway WebSocket 客户端。
// 传输与连接策略对齐 iOS GatewayClient：配对握手（Sec-WebSocket-Protocol:
// dsh-mobile-v1, dsh-pair.<code>）、长期凭据（Authorization: Bearer）、
// 断线重连、请求/响应路由（requestType/rpcId 关联）。
//
// 小程序差异：wx.connectSocket 的 header/protocols 支持随基础库版本变化，
// 真机以 wss 为主；开发工具需勾选「不校验合法域名」才能连 ws:// 局域网地址。

const util = require('./util');
const { ClientSession } = require('./relay-e2ee');
const accessApi = require('./access-api');

/** Uint8Array → 独立 ArrayBuffer（wx.send 要 ArrayBuffer）。 */
function toArrayBuffer(u8) {
  return u8.slice().buffer;
}

const CHANNEL = 'miniprogram';
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const REQUEST_TIMEOUT = 30000;
const SESSION_CREATE_TIMEOUT = 30000;

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
    this.relayShares = {}; // requestId → { resolve, reject, timer }
    this.relayCodes = {};  // requestId → 兑换码生成挂起
    this.relayRedemptions = {}; // requestId → 兑换挂起
    this.deviceId = this.loadOrCreateDeviceId();
    this.probeOnly = false; // 主机在线探测：只验 hello，不重连、不发业务请求
    this.relaySession = null; // v3 relay 模式的 E2EE 会话
    this.relayMeta = null;    // { nodeId, agentPubKey }
    this.relayAccessToken = null;
    this.relayTextFrames = 0; // 诊断：连接器经文本通道发来的帧计数
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

  deviceName() {
    let info;
    try {
      if (typeof wx.getDeviceInfo === 'function') info = wx.getDeviceInfo();
    } catch (e) { /* 旧基础库退回兼容接口 */ }
    if (!info || (!info.brand && !info.model)) {
      try { info = wx.getSystemInfoSync(); } catch (e) { info = {}; }
    }
    info = info || {};
    const clean = value => Array.from(String(value || ''))
      .filter(ch => !/^[\uD800-\uDFFF]$/.test(ch)).join('')
      .replace(/[\u0000-\u001f\u007f\ufffd]/g, '').trim();
    const brand = clean(info.brand), model = clean(info.model);
    const name = brand && model && !model.toLowerCase().startsWith(brand.toLowerCase())
      ? brand + ' ' + model : model || brand;
    return (name || '小程序 ' + this.deviceId.slice(0, 8)).slice(0, 80).replace(/[\uD800-\uDBFF]$/, '');
  }

  /** pairingCode 非空表示一次性配对握手；否则使用已保存的 Bearer 凭据。 */
  connect(endpoint, options) {
    if (!accessApi.isManagedRelay(endpoint)) return this.connectTransport(endpoint, options);
    // Only our hosted relay is metered. LAN/direct/self-hosted connections keep
    // their existing behavior and never depend on the account server.
    this.disconnect({ keepWant: false });
    const generation = this.connectGeneration;
    this.setState('connecting', uiText('正在验证公网有效期…'));
    const opts = options || {};
    if (!opts.relay || !opts.relay.nodeId) {
      this.setState('failed', uiText('请扫描 DSH 插件生成的公网配对二维码'));
      return;
    }
    return accessApi.publicLease(opts.relay.nodeId, this.deviceId).then(lease => {
      if (generation !== this.connectGeneration) return;
      this.connectTransport(endpoint, opts, lease);
    }).catch(error => {
      if (generation !== this.connectGeneration) return;
      this.setState('failed', error.message || uiText('公网授权验证失败；局域网不受影响'));
    });
  }

  connectTransport(endpoint, options, serviceLease) {
    const opts = options || {};
    this.disconnect({ keepWant: false });
    this.probeOnly = !!opts.probe;
    if (!/^wss?:\/\//.test(endpoint || '')) {
      this.setState('failed', uiText('二维码中的 publicUrl 不是有效的 ws:// 或 wss:// 地址'));
      return;
    }
    if (opts.relay && opts.relay.authMode !== 'gateway' && opts.relay.expiresAt && Number(opts.relay.expiresAt) <= Date.now()) {
      this.setState('failed', uiText('公网访问已过期，请重新扫码获取邀请'));
      return;
    }
    this.wantsConnection = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.endpoint = endpoint;
    this.pairingCode = opts.pairingCode || null;
    this.relayMeta = opts.relay || null;
    this.relayAccessToken = (opts.relay && opts.relay.accessToken) || null;
    // 重连必须复用完整连接参数（relay 档案丢了 relay 元信息就永远连不回）
    this.lastConnectOpts = { token: opts.token || null, relay: opts.relay || null };
    if (opts.relay) {
      this.lastConnectOpts.relay = Object.assign({}, opts.relay, {
        inviteToken: opts.relay.inviteToken || null,
        accessToken: opts.relay.accessToken || null
      });
    }
    this.relaySession = null;
    this.setState('connecting');

    const header = {
      'X-DSH-Channel': CHANNEL,
      'X-DSH-Device-ID': this.deviceId
    };
    if (!opts.relay) {
      // 网关要求 UTF-8 标准 Base64；不能直接把中文或 Base64URL 放进头部。
      const name = util.encodeBase64URL(this.deviceName()).replace(/-/g, '+').replace(/_/g, '/');
      header['X-DSH-Device-Name'] = name + '='.repeat((4 - name.length % 4) % 4);
    }
    const protocols = [];
    
    // 正确方式：子协议通过 protocols 数组传递
    // 1. 主协议 dsh-mobile-v1 必须加
    protocols.push('dsh-mobile-v1');
    if (serviceLease) {
      protocols.push('dsh-public.' + serviceLease.token);
      if (opts.relay && opts.relay.authMode === 'gateway') protocols.push('dsh-gateway-auth');
    }

    if (opts.relay && opts.relay.inviteToken) {
      protocols.push('dsh-invite.' + opts.relay.inviteToken);
    } else if (opts.relay && opts.relay.accessToken) {
      protocols.push('dsh-access.' + opts.relay.accessToken);
    }
    
    // 2. 配对码时额外添加 dsh-pair. 子协议
    if (this.pairingCode && !(opts.relay && opts.relay.authMode === 'gateway')) {
      protocols.push('dsh-pair.' + this.pairingCode);
    }
    if (this.relayMeta && this.relayMeta.inviteToken) {
      this.relayMeta.inviteToken = null;
      this.lastConnectOpts.relay.inviteToken = null;
    }
    
    // 3. 已保存 token 时添加 Authorization
    if (opts.token && !(opts.relay && opts.relay.authMode === 'gateway')) {
      header['Authorization'] = 'Bearer ' + opts.token;
    }

    const self = this;
    let transportTask;
    try {
      this.socketTask = wx.connectSocket({
        url: endpoint,
        header: header,
        protocols: protocols,  // 务必传递完整的 protocols 数组
        fail: function (err) {
          if (transportTask && self.socketTask !== transportTask) return;
          self.setState('failed', (err && err.errMsg) || uiText('无法建立 WebSocket 连接'));
          self.scheduleReconnect();
        }
      });
    } catch (e) {
      this.setState('failed', e.message || uiText('无法建立 WebSocket 连接'));
      return;
    }

    transportTask = this.socketTask;

    this.socketTask.onOpen(function () {
      if (self.socketTask !== transportTask) return;
      self.reconnectAttempts = 0;
      if (serviceLease) {
        self.publicLeaseTimer = setTimeout(() => {
          if (self.wantsConnection) self.connect(self.endpoint, self.lastConnectOpts);
        }, Math.max(1, serviceLease.expiresAt - Date.now()));
      }
      if (self.relayMeta) {
        // relay 模式：先完成 E2EE 握手，AgentHello 验签通过后才置 connected
        self.relaySession = new ClientSession(self.relayMeta.nodeId, self.relayMeta.agentPubKey);
        try {
          self.socketTask.send({ data: toArrayBuffer(self.relaySession.hello) });
        } catch (e) {
          self.handleTransportFailure(uiText('E2EE 握手发送失败'));
        }
        return;
      }
      self.setState('connected');
    });
    this.socketTask.onMessage(function (res) {
      if (self.socketTask !== transportTask) return;
      if (self.relayMeta) {
        self.handleRelayMessage(res.data);
        return;
      }
      self.handleFrame(res.data);
    });
    this.socketTask.onError(function (err) {
      if (self.socketTask !== transportTask) return;
      self.handleTransportFailure((err && err.errMsg) || uiText('连接发生错误'));
    });
    this.socketTask.onClose(function (res) {
      if (self.socketTask !== transportTask) return;
      if (self.state === 'connected' || self.state === 'connecting') {
        if (res && Number(res.code) === 4003) {
          if (res.reason === 'public-lease-expired') { self.handleTransportFailure(uiText('正在刷新公网授权')); }
          else if (/^public-access-/.test(res.reason || '')) self.handleAuthorizationFailure(uiText('公网服务未开通、已到期或验证失败，请在设置→公网访问检查或兑换；局域网不受影响'));
          else self.handleAuthorizationFailure(uiText('设备配对已失效，请重新扫描 DSH 二维码'));
        } else if (res && Number(res.code) === 4001) {
          // 中继报告电脑端连接器不在线：停止自动重试，直接把原因显示出来
          self.wantsConnection = false;
          self.publicLeaseTimer && clearTimeout(self.publicLeaseTimer);
          self.handleTransportFailure(uiText('电脑端的公网连接器已离线，请在 DSH 中重新开启「微信连接」后重试'));
          return;
        } else if (res && Number(res.code) === 4004) {
          self.handleAuthorizationFailure(uiText('DSH 电脑端连接器未支持安全公网配对，请升级插件连接器'));
        } else {
          self.handleTransportFailure(uiText('连接已关闭'));
        }
      }
    });

    this.startConnectionTimeout();
  }

  startConnectionTimeout() {
    const self = this;
    this.clearConnectionTimeout();
    this.timeoutTimer = setTimeout(function () {
      if (self.state === 'connecting') {
        self.handleTransportFailure(uiText('连接超时'));
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
    clearTimeout(this.publicLeaseTimer);
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
      this.setState('failed', message + uiText('，配对码已失效，请重新扫码'));
      return;
    }
    if (this.relayMeta && !this.relayAccessToken &&
        !(this.relayMeta.authMode === 'gateway' && this.lastConnectOpts && this.lastConnectOpts.token)) {
      this.wantsConnection = false;
      this.setState('failed', uiText('公网邀请已使用或失效，请重新获取配对信息'));
      return;
    }
    this.setState('failed', message);
    this.scheduleReconnect();
  }

  handleAuthorizationFailure(message) {
    clearTimeout(this.publicLeaseTimer);
    this.clearConnectionTimeout();
    this.wantsConnection = false;
    const socket = this.socketTask;
    this.socketTask = null;
    if (socket) {
      try { socket.close({}); } catch (e) { /* 忽略 */ }
    }
    this.failAllPending(message);
    this.setState('failed', message);
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
        self.connect(self.endpoint, self.lastConnectOpts || { token: self.lastToken || null });
      }
    }, delay);
  }

  disconnect(options) {
    this.connectGeneration = (this.connectGeneration || 0) + 1;
    clearTimeout(this.publicLeaseTimer);
    this.publicLeaseTimer = null;
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
    this.relayAccessToken = null;
    this.failAllPending(uiText('连接已断开'));
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
    const shares = this.relayShares;
    this.relayShares = {};
    Object.keys(shares).forEach(function (key) {
      clearTimeout(shares[key].timer);
      shares[key].reject(new Error(message));
    });
  }

  // ---------- relay（E2EE） ----------

  /**
   * 上报手机型号。relay connector 解密后不再转发，而是调用插件的
   * POST /mgw/devices/:id/rename，让 WebUI「可信设备」显示真实手机
   * 而不是跑 connector 的那台主机。
   *
   * 中继会把客户端子协议归一化，所以这条密封帧是唯一能把手机身份
   * 送出来的通道。
   */
  reportDeviceInfo() {
    const frame = { type: 'device-info', model: this.deviceName() };
    // 此刻刚 setState('connected')，正常必然发得出去；万一被拒，隔半秒补一次。
    // connector 只更新当前已认证设备，重复上报无害。
    if (!this.send(frame)) {
      setTimeout(() => { if (this.state === 'connected') this.send(frame) }, 500);
    }
  }

  /** relay 模式的二进制消息：握手包或密文帧。 */
  handleRelayMessage(data) {
    if (!(data instanceof ArrayBuffer)) {
      // 部分连接器用文本通道发送明文控制/数据帧：按普通帧处理而非静默丢弃
      if (typeof data === 'string') {
        // 中继明文只允许自身控制帧，不能伪造 hello/paired 或业务数据。
        let frame;
        try { frame = JSON.parse(data); } catch (e) { return; }
        if (this.relayMeta.authMode === 'gateway') return;
        if (frame.kind !== 'relay-authorized' && frame.kind !== 'relay-client-count') return;
        this.handleFrame(data);
        this.relayTextFrames += 1;
      }
      return;
    }
    const bytes = new Uint8Array(data);
    const session = this.relaySession;
    if (!session) return;
    if (!session.ready) {
      if (!session.acceptAgentHello(bytes)) {
        this.handleTransportFailure(uiText('E2EE 握手失败：agent 身份验签未通过，可能存在中间人，请重新扫码确认配对信息'));
      } else {
        if (this.relayMeta.authMode === 'gateway') {
          // 先验证主机身份，再通过密文交付一次性码/设备 token。
          // 等收到网关 hello 才触发 connected 和首页数据加载。
          const auth = { type: 'relay-auth', deviceId: this.deviceId, deviceName: this.deviceName() };
          if (this.pairingCode) auth.pairingCode = this.pairingCode;
          else auth.token = this.lastConnectOpts && this.lastConnectOpts.token;
          if (!auth.pairingCode && !auth.token) {
            this.handleAuthorizationFailure(uiText('缺少配对凭据，请重新扫描 DSH 的二维码'));
            return;
          }
          try {
            this.socketTask.send({ data: toArrayBuffer(session.seal(JSON.stringify(auth))) });
          } catch (e) { this.handleTransportFailure(uiText('发送加密配对凭据失败')); }
          return;
        }
        this.clearConnectionTimeout();
        this.setState('connected');
        // Report the phone model once per connection. The relay connector
        // relabels the paired gateway device with it, so the trusted-device
        // list shows this phone instead of the host running the connector.
        this.reportDeviceInfo();
      }
      return;
    }
    const text = session.open(bytes);
    if (text === null) {
      this.handleTransportFailure(uiText('E2EE 解密失败，连接已终止'));
      return;
    }
    this.handleFrame(text);
  }

  // ---------- 收发 ----------

  send(object) {
    if (!this.socketTask || this.state !== 'connected') {
      if (this.cb.onNotice) this.cb.onNotice(uiText('WebSocket 尚未连接'), true);
      return false;
    }
    try {
      if (this.relayMeta) {
        if (!this.relaySession || !this.relaySession.ready) {
          if (this.cb.onNotice) this.cb.onNotice(uiText('E2EE 会话未就绪'), true);
          return false;
        }
        this.socketTask.send({ data: toArrayBuffer(this.relaySession.seal(JSON.stringify(object))) });
        return true;
      }
      this.socketTask.send({ data: JSON.stringify(object) });
      return true;
    } catch (e) {
      this.handleTransportFailure(e.message || uiText('发送失败'));
      return false;
    }
  }

  handleFrame(data) {
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
    if (frame.kind !== 'relay-authorized' && frame.kind !== 'relay-client-count') {
      this.clearConnectionTimeout();
    }

    if (frame.kind === 'paired') {
      this.lastToken = frame.token || null;
      if (this.lastToken) {
        this.pairingCode = null;
        this.lastConnectOpts.token = this.lastToken;
      }
      if (this.cb.onPaired) this.cb.onPaired(frame);
    }

    if (frame.kind === 'relay-auth-error') {
      this.handleAuthorizationFailure(frame.message || uiText('配对码或设备凭据无效，请重新扫码'));
      return;
    }
    if (frame.kind === 'hello' && this.relayMeta && this.relayMeta.authMode === 'gateway' && this.state === 'connecting') {
      this.setState('connected');
      this.reportDeviceInfo();
    }

    if (frame.kind === 'relay-authorized') {
      this.relayAccessToken = frame.accessToken || null;
      if (this.lastConnectOpts && this.lastConnectOpts.relay) {
        this.lastConnectOpts.relay.accessToken = this.relayAccessToken;
        this.lastConnectOpts.relay.inviteToken = null;
      }
      if (this.cb.onRelayAuthorized) this.cb.onRelayAuthorized(frame, this.relayMeta);
      return;
    }

    if (frame.kind === 'relay-client-count') {
      if (this.cb.onRelayClientCount) this.cb.onRelayClientCount(Number(frame.count || 0), this.relayMeta);
      return;
    }

    if (frame.kind === 'relay-code-created' || frame.kind === 'relay-code-error') {
      const pending = frame.requestId && this.relayCodes[frame.requestId];
      if (pending) {
        delete this.relayCodes[frame.requestId];
        clearTimeout(pending.timer);
        if (frame.kind === 'relay-code-created') pending.resolve(frame);
        else pending.reject(new Error(frame.message || uiText('生成兑换码失败')));
      }
      return;
    }

    if (frame.kind === 'relay-code-redeemed' || (frame.kind === 'relay-code-error' && frame.requestId && this.relayRedemptions[frame.requestId])) {
      const pending = frame.requestId && this.relayRedemptions[frame.requestId];
      if (pending) {
        delete this.relayRedemptions[frame.requestId];
        clearTimeout(pending.timer);
        if (frame.kind === 'relay-code-redeemed') pending.resolve(frame);
        else pending.reject(new Error(frame.message || uiText('兑换失败')));
      }
      return;
    }

    if (frame.kind === 'relay-share-created' || frame.kind === 'relay-share-error') {
      const share = frame.requestId && this.relayShares[frame.requestId];
      if (share) {
        delete this.relayShares[frame.requestId];
        clearTimeout(share.timer);
        if (frame.kind === 'relay-share-created') share.resolve(frame);
        else share.reject(new Error(frame.message || uiText('创建分享失败')));
      }
      return;
    }

    // Inspector history must never replace the active conversation or subscription.
    // Old gateway history errors omit sessionId. They cannot be attributed to
    // the parent safely while an inspector is outstanding; its timeout owns them.
    if (frame.kind === 'error' && frame.requestType === 'history' && !frame.sessionId
      && Object.keys(this.pendingRequests).some(key => key.indexOf('inspector:') === 0)) return;
    const inspectorKey = frame.sessionId && 'inspector:' + frame.sessionId;
    const inspector = inspectorKey && this.pendingRequests[inspectorKey];
    if (inspector && (frame.kind === 'history' || frame.kind === 'error' && frame.requestType === 'history')) {
      delete this.pendingRequests[inspectorKey]; clearTimeout(inspector.timer);
      if (frame.kind === 'error') inspector.reject(new Error(frame.message || frame.code));
      else inspector.resolve(frame);
      if (this.activeSessionId !== frame.sessionId) return;
    }
    this.resolveCorrelated(frame);
    if (this.cb.onFrame) this.cb.onFrame(frame);
  }

  /** 所有者生成兑换码：续期 accessTtlMs，可用 uses 次 */
  createRelayCode(accessTtlMs, uses, codeTtlMs) {
    const requestId = util.uuid();
    const self = this;
    return new Promise(function (resolve, reject) {
      if (!self.relayMeta || self.state !== 'connected') {
        reject(new Error(uiText('公网节点未连接')));
        return;
      }
      const timer = setTimeout(function () {
        delete self.relayCodes[requestId];
        reject(new Error(uiText('生成兑换码超时')));
      }, REQUEST_TIMEOUT);
      self.relayCodes[requestId] = { resolve: resolve, reject: reject, timer: timer };
      if (!self.send({ type: 'relay-code-create', requestId: requestId,
        accessTtlMs: accessTtlMs, uses: uses, codeTtlMs: codeTtlMs })) {
        delete self.relayCodes[requestId];
        clearTimeout(timer);
        reject(new Error(uiText('兑换码请求发送失败')));
      }
    });
  }

  /** 访客兑换续期码 */
  redeemRelayCode(code) {
    const requestId = util.uuid();
    const self = this;
    return new Promise(function (resolve, reject) {
      if (!self.relayMeta || self.state !== 'connected') {
        reject(new Error(uiText('公网节点未连接')));
        return;
      }
      const timer = setTimeout(function () {
        delete self.relayRedemptions[requestId];
        reject(new Error(uiText('兑换超时')));
      }, REQUEST_TIMEOUT);
      self.relayRedemptions[requestId] = { resolve: resolve, reject: reject, timer: timer };
      if (!self.send({ type: 'relay-code-redeem', requestId: requestId, code: code })) {
        delete self.relayRedemptions[requestId];
        clearTimeout(timer);
        reject(new Error(uiText('兑换请求发送失败')));
      }
    });
  }

  createRelayShare(ttlMs) {
    const requestId = util.uuid();
    const self = this;
    return new Promise(function (resolve, reject) {
      if (!self.relayMeta || self.state !== 'connected') {
        reject(new Error(uiText('公网节点未连接')));
        return;
      }
      const timer = setTimeout(function () {
        delete self.relayShares[requestId];
        reject(new Error(uiText('创建分享超时')));
      }, REQUEST_TIMEOUT);
      self.relayShares[requestId] = { resolve: resolve, reject: reject, timer: timer };
      if (!self.send({ type: 'relay-share-create', requestId: requestId, ttlMs: ttlMs })) {
        delete self.relayShares[requestId];
        clearTimeout(timer);
        reject(new Error(uiText('分享请求发送失败')));
      }
    });
  }

  resolveCorrelated(frame) {
    // Download errors have requestType but no requestId/transferId on older gateways.
    // Keep one request per file-operation lane and validate success ownership.
    const fileTypes = { 'file-download-opened': 'file-download-open', 'file-download-chunk': 'file-download-read', 'file-download-cancelled': 'file-download-cancel' };
    const fileType = frame.kind === 'error' ? frame.requestType : fileTypes[frame.kind];
    const fileKey = fileType && 'file:' + fileType;
    const fileRequest = fileKey && this.pendingRequests[fileKey];
    if (fileRequest) {
      if (frame.kind !== 'error' && (frame.kind !== fileRequest.expectedKind ||
        (fileRequest.requestId && frame.requestId !== fileRequest.requestId) ||
        (fileRequest.transferId && frame.transferId !== fileRequest.transferId) ||
        (fileRequest.sessionId && frame.sessionId !== fileRequest.sessionId))) return;
      delete this.pendingRequests[fileKey]; clearTimeout(fileRequest.timer);
      if (frame.kind === 'error') fileRequest.reject(Object.assign(new Error(frame.message || frame.code), { code: frame.code }));
      else fileRequest.resolve(frame);
      return;
    }
    // Legacy gateways omit correlation metadata for unknown message types.
    if (frame.kind === 'error' && !frame.requestId && typeof frame.message === 'string') {
      const unknown = /^unknown message type: (plugin-market-(?:indexes|set-indexes|search)|plugin-credential-(?:describe|set)|plugin-translation-limits)$/.exec(frame.message);
      if (unknown) {
        for (const key of Object.keys(this.pendingRequests)) {
          const pending = this.pendingRequests[key];
          if (key.indexOf('plugin:') === 0 && pending.expectedKind === unknown[1]) {
            delete this.pendingRequests[key]; clearTimeout(pending.timer);
            pending.reject(new Error(uiText(unknown[1].indexOf('plugin-market-') === 0 ? '当前网关未提供插件市场接口，请更新网关后重试' : '当前网关尚未开放此功能，请更新网关后重试。')));
          }
        }
        return;
      }
    }
    // Install events reuse the request ID, but only the final reply settles it.
    const pluginKey = frame.requestId && 'plugin:' + frame.requestId;
    const pluginRequest = pluginKey && this.pendingRequests[pluginKey];
    if (pluginRequest) {
      if (frame.kind === pluginRequest.expectedKind || frame.kind === 'error') {
        delete this.pendingRequests[pluginKey];
        clearTimeout(pluginRequest.timer);
        if (frame.kind === 'error') pluginRequest.reject(Object.assign(new Error(frame.message || frame.code || uiText('插件请求失败')), { code: frame.code }));
        else pluginRequest.resolve(frame);
      }
      return;
    }
    const historyKey = frame.requestId && 'schedule-history:' + frame.requestId;
    const historyRequest = historyKey && this.pendingRequests[historyKey];
    if (historyRequest && (frame.kind === 'schedule-history' || frame.kind === 'error')) {
      delete this.pendingRequests[historyKey]; clearTimeout(historyRequest.timer);
      if (frame.kind === 'error') historyRequest.reject(new Error(frame.message || uiText('无法读取运行记录')));
      else historyRequest.resolve(frame);
      return;
    }
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
          pending.reject(new Error(frame.message || uiText('创建会话失败')));
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
    // requestType 关联的控制请求；响应帧可能缺 requestType，回退按 kind 匹配
    // （对齐 dsh-mobile GatewayRuntime 按响应 kind 匹配挂起 lane 的做法）
    var pendingReq = null;
    if (frame.requestType && this.pendingRequests['type:' + frame.requestType]) {
      pendingReq = this.pendingRequests['type:' + frame.requestType];
    } else if (frame.kind && this.pendingRequests['type:' + frame.kind]) {
      pendingReq = this.pendingRequests['type:' + frame.kind];
    }
    if (pendingReq && (frame.kind === 'error' || !frame.requestType
      || frame.kind === frame.requestType || frame.kind === pendingReq.expectedKind)) {
      delete this.pendingRequests[pendingReq.key];
      clearTimeout(pendingReq.timer);
      if (frame.kind === 'error') {
        pendingReq.reject(new Error(frame.message || frame.code || (frame.requestType + '-failed')));
      } else {
        pendingReq.resolve(frame);
      }
    }
  }

  /** 发送并等待关联响应；同一 requestType 仅允许一个在途请求。 */
  request(object, options) {
    const opts = options || {};
    const self = this;
    return new Promise(function (resolve, reject) {
      if (!self.send(object)) {
        reject(new Error(uiText('WebSocket 尚未连接')));
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
        previous.reject(new Error(uiText('已被新的同类请求取代')));
      }
      const timer = setTimeout(function () {
        delete self.pendingRequests[key];
        reject(new Error(uiText('请求超时：') + object.type));
      }, opts.timeout || REQUEST_TIMEOUT);
      self.pendingRequests[key] = {
        resolve: resolve, reject: reject, timer: timer, key: key,
        expectedKind: opts.matchType || object.type
      };
    });
  }

  createSession(workspaceId, agentPreset) {
    const self = this;
    const requestId = util.uuid();
    return new Promise(function (resolve, reject) {
      const payload = { type: 'session-create', requestId: requestId };
      if (workspaceId) payload.workspaceId = workspaceId;
      if (agentPreset) payload.agentPreset = agentPreset;
      if (!self.send(payload)) {
        reject(new Error(uiText('WebSocket 尚未连接')));
        return;
      }
      const timer = setTimeout(function () {
        delete self.sessionCreations[requestId];
        reject(new Error(uiText('创建会话超时')));
      }, SESSION_CREATE_TIMEOUT);
      self.sessionCreations[requestId] = { resolve: resolve, reject: reject, timer: timer };
    });
  }

  // ---------- 语义化请求 ----------

  ping() { return this.request({ type: 'ping' }, { matchType: 'ping' }); }

  requestQueue(sessionId) {
    return this.request({ type: 'session-queue', sessionId: sessionId });
  }

  queueUpdate(sessionId, itemId, action) {
    // action: 'remove' | 'steer'（对齐 GatewayRequests.queueUpdate）
    return this.request(
      { type: 'queue-update', sessionId: sessionId, itemId: itemId, action: action },
      { matchType: 'queue-item-updated' }
    );
  }

  requestCommands(sessionId) {
    return this.request({ type: 'commands', sessionId: sessionId, locale: require('./ui-preferences').locale() === 'en' ? 'en' : 'zh-CN' });
  }

  requestCommandOptions(sessionId, command) {
    return this.request(
      { type: 'command-options', sessionId: sessionId, command: command },
      { matchType: 'command-options' }
    );
  }

  selectCommandOption(sessionId, command, optionId) {
    return this.request(
      { type: 'command-select', sessionId: sessionId, command: command, optionId: optionId },
      { matchType: 'command-selected' }
    );
  }

  executeCommand(sessionId, line, images) {
    return this.request({
      type: 'command-execute',
      sessionId: sessionId,
      line: line,
      images: (images || []).map(function (img) {
        return { mediaType: img.mediaType, data: img.data, name: img.name || null };
      })
    }, { matchType: 'command-executed' });
  }

  requestTasks(sessionId) {
    return this.request({ type: 'tasks', sessionId: sessionId });
  }

  requestGoal(sessionId) {
    return this.request({ type: 'goal', sessionId: sessionId });
  }

  editGoal(sessionId, ref, objective) {
    return this.request({
      type: 'goal-edit', sessionId: sessionId, ref: ref, objective: objective
    }, { matchType: 'goal-edited' });
  }

  updateGoalState(type, sessionId, ref) {
    const responseKinds = {
      'goal-pause': 'goal-paused',
      'goal-resume': 'goal-resumed',
      'goal-clear': 'goal-cleared'
    };
    return this.request(
      { type: type, sessionId: sessionId, ref: ref },
      { matchType: responseKinds[type] || type }
    );
  }
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

  /** 会话工作区文件列表：网关解析会话所属工作区根目录，path 为相对路径（缺省 = 根）。 */
  requestFileList(sessionId, path) {
    const payload = { type: 'file-list', requestId: util.uuid(), sessionId: sessionId };
    if (path) payload.path = path;
    return this.request(payload, { matchType: 'file-list' });
  }

  requestChangesSummary(sessionId, seq) {
    return this.requestPlugin('workspace-changes-summary', { sessionId, seq });
  }

  requestChangesDiff(sessionId, seq, index) {
    return this.requestPlugin('workspace-changes-diff', { sessionId, seq, index });
  }

  requestFileTransfer(payload, expectedKind) {
    const key = 'file:' + payload.type;
    return new Promise((resolve, reject) => {
      if (this.pendingRequests[key]) { reject(new Error(uiText('文件正在下载，请稍候'))); return; }
      const timer = setTimeout(() => { delete this.pendingRequests[key]; reject(new Error(uiText('文件下载超时，请重试'))); }, REQUEST_TIMEOUT);
      this.pendingRequests[key] = { key, resolve, reject, timer, expectedKind,
        requestId: payload.requestId, transferId: payload.transferId, sessionId: payload.sessionId };
      if (!this.send(payload)) { delete this.pendingRequests[key]; clearTimeout(timer); reject(new Error(uiText('请先连接网关'))); }
    });
  }

  openFileDownload(sessionId, path) {
    return this.requestFileTransfer({ type: 'file-download-open', requestId: util.uuid(), sessionId, path }, 'file-download-opened');
  }

  readFileDownload(transferId, offset) {
    return this.requestFileTransfer({ type: 'file-download-read', transferId, offset }, 'file-download-chunk');
  }

  cancelFileDownload(transferId) {
    return this.requestFileTransfer({ type: 'file-download-cancel', transferId }, 'file-download-cancelled');
  }

  requestContextUsage(sessionId) {
    return this.request({ type: 'context-usage', sessionId: sessionId });
  }

  requestHistory(sessionId, beforeSeq, historyFormatVersion) {
    // 对齐 dsh-mobile v1.7.5 的会话视图分页：限制消息数和字节数，
    // 避免旧会话一次读取过大而在 Host 查询阶段超时。
    const payload = {
      type: 'history',
      sessionId: sessionId,
      maxMessages: 60,
      maxBytes: 4 * 1024 * 1024,
      view: 'conversation'
    };
    if (beforeSeq !== undefined && beforeSeq !== null && beforeSeq >= 0 && historyFormatVersion) {
      payload.beforeSeq = beforeSeq;
      payload.historyFormatVersion = historyFormatVersion;
    }
    return this.send(payload);
  }

  inspectSession(sessionId) {
    const key = 'inspector:' + sessionId;
    if (this.pendingRequests[key]) return this.pendingRequests[key].promise;
    const promise = new Promise((resolve,reject) => {
      if (!sessionId) return reject(new Error(uiText('加载记录失败，请重试')));
      const pending = { resolve, reject, timer:null };
      // Older gateways omit requestId. Retain timed-out ownership until its late
      // reply or disconnect so it cannot resolve a retry or enter conversation state.
      pending.timer = setTimeout(() => {
        pending.resolve = () => {}; pending.reject = () => {};
        const error = new Error(uiText('记录请求超时，请重新连接后重试')); error.code = 'INSPECTOR_TIMEOUT'; reject(error);
      }, REQUEST_TIMEOUT);
      this.pendingRequests[key] = pending;
      if (!this.send({type:'history',sessionId,maxMessages:20,maxBytes:256*1024,view:'conversation'})) {
        delete this.pendingRequests[key]; clearTimeout(pending.timer); reject(new Error(uiText('请先连接网关')));
      }
    });
    if (this.pendingRequests[key]) this.pendingRequests[key].promise = promise;
    return promise;
  }

  requestAttachment(sessionId, attachmentId) {
    return this.request({ type: 'attachment', sessionId: sessionId, attachmentId: attachmentId });
  }

  subscribe(sessionId) {
    this.activeSessionId = sessionId || null;
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
      clientTimeZone: this.timeZone()
    };
    // An omitted mode is a normal immediate message. Only add queue/steer
    // when the caller explicitly requests an in-flight conversation action.
    if (mode) payload.mode = mode;
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

  // ---------- 定时任务（对齐 dsh-mobile v1.6.x schedule protocol） ----------

  /** 全部会话的定时任务目录；响应帧 kind=schedule-catalog，items 为任务记录。 */
  requestScheduleHistory(sessionId, id, before) {
    const requestId = util.uuid(), key = 'schedule-history:' + requestId;
    const payload = { type: 'schedule-history', requestId, sessionId, id, limit: 20 };
    if (before) payload.before = before;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { delete this.pendingRequests[key]; reject(new Error(uiText('运行记录请求超时'))); }, REQUEST_TIMEOUT);
      this.pendingRequests[key] = { resolve, reject, timer, key, expectedKind: 'schedule-history' };
      if (!this.send(payload)) { clearTimeout(timer); delete this.pendingRequests[key]; reject(new Error(uiText('请先连接网关'))); }
    });
  }

  requestScheduleCatalog() {
    return this.request({ type: 'schedule-catalog' });
  }

  /**
   * 更新定时任务。expected 为任务原始记录（乐观并发）；change 为
   * {kind:'at',at} / {kind:'daily',daily:{time,time_zone}} / {kind:'weekly',weekly:{...}}。
   * 响应帧 kind=schedule-update（updated 布尔）或 error（requestType=schedule-update），
   * 由 store 按 requestId 关联处理（对齐 iOS AppStore 手动路由）。
   */
  sendScheduleUpdate(sessionId, id, expected, title, prompt, change, requestId) {
    const payload = {
      type: 'schedule-update',
      sessionId: sessionId,
      id: id,
      expected: expected,
      title: title,
      prompt: prompt,
      requestId: requestId
    };
    if (change) payload.change = change;
    return this.send(payload);
  }

  /** 删除定时任务及其投递记录；响应帧 kind=schedule-delete（deleted 布尔）。 */
  sendScheduleDelete(sessionId, id, requestId) {
    return this.send({
      type: 'schedule-delete',
      sessionId: sessionId,
      id: id,
      requestId: requestId
    });
  }

  // ---------- 插件管理（对齐 dsh-mobile v1.7.x plugin protocol） ----------

  requestPlugin(type, payload, timeout) {
    const object = Object.assign({}, payload || {}, { type: type });
    object.requestId = object.requestId || util.uuid();
    const expectedKind = { 'plugin-inspect': 'plugin-inspection', 'plugin-install': 'plugin-install-result', 'speech-configure': 'speech-configured', 'speech-prepare': 'speech-preparing', 'speech-cancel-preparation': 'speech-preparation-cancelled', 'speech-transcribe': 'speech-transcript', 'speech-cancel': 'speech-cancelled', 'speech-subscribe': 'speech-subscribed', 'speech-unsubscribe': 'speech-unsubscribed' }[type] || type;
    const key = 'plugin:' + object.requestId;
    return new Promise((resolve, reject) => {
      if (this.pendingRequests[key]) { reject(new Error(uiText('插件请求正在进行'))); return; }
      const timer = setTimeout(() => {
        delete this.pendingRequests[key];
        reject(new Error(uiText('插件请求超时，请核对状态后重试')));
      }, timeout || REQUEST_TIMEOUT);
      this.pendingRequests[key] = { resolve, reject, timer, key, expectedKind };
      if (!this.send(object)) {
        clearTimeout(timer);
        delete this.pendingRequests[key];
        reject(new Error(uiText('连接网关后才能管理插件')));
      }
    });
  }

  /** 插件目录；响应帧 kind=plugin-catalog（bundles/plugins/officialItems）。 */
  sendPluginCatalog(requestId) {
    return this.send({ type: 'plugin-catalog', requestId: requestId });
  }

  /** 启用/停用整个插件 bundle；响应帧 kind=plugin-bundle-set-enabled（result.application）。 */
  sendPluginBundleSetEnabled(requestId, name, enabled) {
    return this.send({
      type: 'plugin-bundle-set-enabled',
      requestId: requestId,
      name: name,
      enabled: enabled
    });
  }

  /** 启用/停用插件内单个组件条目；响应帧 kind=plugin-entry-set-enabled。 */
  sendPluginEntrySetEnabled(requestId, entryId, enabled) {
    return this.send({
      type: 'plugin-entry-set-enabled',
      requestId: requestId,
      entryId: entryId,
      enabled: enabled
    });
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
