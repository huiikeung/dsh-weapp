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
const publicAccessPrompt = require('./public-access-prompt');
const routeTable = require('./route-table');
const hosts = require('./hosts');
const accessConfig = require('./access-config');
const runtime = require('./runtime');

/** Uint8Array → 独立 ArrayBuffer（wx.send 要 ArrayBuffer）。 */
function toArrayBuffer(u8) {
  return u8.slice().buffer;
}

function socketErrorMessage(value, endpoint) {
  const error = value && typeof value === 'object' ? value : null;
  const raw = String(error ? error.errMsg || error.message || '' : value || '');
  const errorCode = error && [error.errno, error.errCode].find(item => Number.isFinite(Number(item)));
  if (/2302998|not allowed to access this domain/i.test(raw)) {
    const match = /^wss?:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(String(endpoint || ''));
    const host = match && !match[1].includes('@') ? match[1].replace(/:\d+$/, '') : '';
    if (host && hosts.isLocalHost(host)) {
      return uiText('ASCF 当前回退到局域网地址 {host}：IP/局域网不能加入元服务白名单，请先恢复公网中继再重新配对。', { host: host });
    }
    if (host) return uiText('ASCF 域名未配置：当前 WebSocket 主机 {host} 未在元服务白名单中；请核对 Bundle Name 和签名证书。', { host: 'wss://' + host });
    return uiText('ASCF 域名未配置：请在华为开发者中心/AGC 的元服务服务器域名白名单中加入该 wss 域名；局域网 ws 地址不能绕过平台白名单。');
  }
  if (/unknown error/i.test(raw) && errorCode !== undefined) return raw + ' (errno ' + Number(errorCode) + ')';
  return raw || uiText('无法建立 WebSocket 连接');
}

const CHANNEL = 'miniprogram';
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
// 抖动链路（握手成功但几秒内又断）不能每次连上都把退避清零，否则永远是 1s
// 重连一次，体感就是「一直在重连」。只有稳定存活超过该阈值才清零。
const CONNECTION_STABLE_MS = 20000;
const RECONNECT_JITTER = 0.3; // ±30% 抖动，避免多端同时重连撞在一起
// 前台保活：中继/Cloudflare/运营商 NAT 对静默连接有 60–100s 的空闲回收，
// 只靠 onClose 发现不了“半死”连接；应用层心跳要早于这些超时。
const HEARTBEAT_INTERVAL_MS = 25000;
const HEARTBEAT_TIMEOUT_MS = 8000;
// 单次回包慢不足以判定断链（弱网下很常见），连续 miss 两次才重连。
const HEARTBEAT_MAX_MISSES = 2;
const REQUEST_TIMEOUT = 30000;
const SESSION_CREATE_TIMEOUT = 30000;
// 配对期每个候选地址的最长等待：候选可能包含不可达的内网地址（手输/旧二维码），
// 操作系统默认 TCP 超时可达 30s+，逐候选等待会让「换一条线路」拖到一分钟以上。
// 达到该时长即视为本候选不可达，按候选顺序继续尝试（中继候选含 E2EE 握手，仍用 REQUEST_TIMEOUT）。
const PAIRING_CONNECT_TIMEOUT = 30000;

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
    this.timeoutToken = null;
    this.pendingRequests = {}; // key → { resolve, reject, timer }
    this.sessionParents = Object.create(null); // 子 Agent 会话 → durable parent address
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
    this.deviceForgetPending = null;
    this.pairingFallbacks = [];
    this.pairingFallbackKinds = null; // 与 pairingFallbacks 对齐的线路族（回退时带上）
    this.routeKind = null;           // 当前候选的线路族：lan | public | relay
    this.candidateKinds = null;      // 本次尝试的候选线路族（首选 + 剩余回退）
    this.pairingAllKinds = null;      // 本次配对的全部候选线路族（回退链上保持不变）
    this.socketOpened = false;       // TCP/TLS 是否已建立（区分「连不上」与「握手慢」）
    this.stableTimer = null;         // 连接稳定存活计时（到期才清零重连退避）
    this.connectedAt = 0;            // 最近一次进入 connected 的时间
    this.connectAttempt = null;      // 当前拨号目标的签名（重复 connect 去重用）
    this.heartbeatEnabled = true;    // 前台保活开关（store 随 App 前后台切换）
    this.heartbeatTimer = null;
    this.heartbeatPending = false;
    this.heartbeatMisses = 0;
    this.lastInboundAt = 0;          // 最近一次收到任何入站帧（心跳/自检判定「链路是否活着」用）
  }

  // ---------- 状态 ----------

  setState(state, message, errorCode, deliberate) {
    this.state = state;
    if (state === 'connected') {
      this.clearConnectionTimeout();
      this.connectedAt = Date.now();
      // 稳定存活 CONNECTION_STABLE_MS 之后才清零退避：抖动链路每次都能握手、
      // 又在几秒内被断开时，退避按 1/2/4/8… 递增，而不是永远 1s 重连一次。
      this.scheduleStableReset();
      if (this.heartbeatEnabled) this.startHeartbeat();
    } else {
      this.clearStableReset();
      this.stopHeartbeat();
    }
    // deliberate：用户主动断开（切换主机/移除节点/设置里断开），
    // 与「曾连上又掉线」区分开，首页据此把断链显示为红色。
    if (this.cb.onState) this.cb.onState(state, message || null, errorCode || null, deliberate === true);
  }

  scheduleStableReset() {
    this.clearStableReset();
    if (!this.reconnectAttempts) return; // 退避本来就是 0，不必多挂一个计时器
    const self = this;
    this.stableTimer = setTimeout(function () {
      self.stableTimer = null;
      if (self.state === 'connected') self.reconnectAttempts = 0;
    }, CONNECTION_STABLE_MS);
  }

  clearStableReset() {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  // ---------- 心跳 ----------

  /**
   * 前台保活（store 随 App 前后台/原生浮层切换）。心跳用独立 key 的 ping，
   * 不与 store 的前台自检互相取代；连续 miss HEARTBEAT_MAX_MISSES 次才判定
   * 断链——单次回包慢（弱网、刚唤醒）不该拆掉一条好连接。
   */
  setHeartbeatEnabled(enabled) {
    const next = enabled !== false;
    if (this.heartbeatEnabled === next) return;
    this.heartbeatEnabled = next;
    if (next) this.startHeartbeat();
    else this.stopHeartbeat();
  }

  startHeartbeat() {
    this.stopHeartbeat();
    if (!this.heartbeatEnabled || this.probeOnly || this.state !== 'connected') return;
    const self = this;
    this.heartbeatTimer = setInterval(function () { self.runHeartbeat(); }, HEARTBEAT_INTERVAL_MS);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.heartbeatPending = false;
    this.heartbeatMisses = 0;
  }

  runHeartbeat() {
    if (!this.heartbeatEnabled || this.state !== 'connected' || this.probeOnly) return;
    if (this.heartbeatPending) return;
    const self = this;
    this.heartbeatPending = true;
    Promise.resolve(this.request({ type: 'ping' }, {
      matchType: 'pong', key: 'heartbeat:ping', timeout: HEARTBEAT_TIMEOUT_MS
    })).then(function () {
      self.heartbeatPending = false;
      self.heartbeatMisses = 0;
    }, function () {
      self.heartbeatPending = false;
      if (self.state !== 'connected') return;
      // 会话页渲染/流式消息会把 JS 线程占住，pong 只是「晚到」而不是链路已死：
      // 只要最近 30s 内有任何入站帧，就不计入 miss，避免误拆一条好连接。
      if (self.lastInboundAt && Date.now() - self.lastInboundAt < 30000) {
        self.heartbeatMisses = 0;
        return;
      }
      self.heartbeatMisses += 1;
      try {
        console.log('[gateway] heartbeat miss ' + self.heartbeatMisses + '/' + HEARTBEAT_MAX_MISSES);
      } catch (e) { /* 无 console 环境忽略 */ }
      if (self.heartbeatMisses < HEARTBEAT_MAX_MISSES) return;
      self.handleTransportFailure(uiText('连接无响应（心跳超时）'));
    });
  }

  // ---------- 设备标识 ----------

  loadOrCreateDeviceId() {
    try {
      let id = has.getStorageSync('dsh_device_id');
      if (!id) {
        id = util.uuid();
        has.setStorageSync('dsh_device_id', id);
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
      if (typeof has.getDeviceInfo === 'function') info = has.getDeviceInfo();
    } catch (e) { /* 旧基础库退回兼容接口 */ }
    if (!info || (!info.brand && !info.model)) {
      try { info = has.getSystemInfoSync(); } catch (e) { info = {}; }
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

  /**
   * 拨号目标签名：同一 endpoint + 同一凭据/中继档案算同一次尝试。
   * App.onShow、网络状态回调、租赁刷新会在拨号过程中重复触发 connect()，
   * 旧实现每次都先 disconnect() 拆掉在拨的 socket 再重拨，服务端看到的就是
   * 「连上 0.2s 又断、2s 后再连」的抖动；同目标在拨号中直接忽略。
   */
  connectSignature(endpoint, options) {
    const opts = options || {};
    const relay = opts.relay || null;
    return [
      String(endpoint || ''),
      opts.token || '',
      opts.pairingCode || '',
      // 邀请/访问令牌是随时会被 relay-authorized 刷新的易变字段，不能参与
      // 「是否同一次拨号」的判定：否则同一目标的重复 connect 会因为 token
      // 变了而绕过去重，开出第二条 socket（两条 E2EE 会话互相踩坏、连接被拆）。
      relay ? [relay.nodeId || '', relay.authMode || '', relay.role || ''].join('~') : '',
      opts.probe ? 'probe' : 'live',
      // 走托管中继取租赁与直连拨号是两条不同的路径：同一个地址在两种判定下
      // 不能当成同一次尝试（否则切换路径的 connect 会被去重忽略）。
      typeof accessApi.isManagedRelay === 'function' && accessApi.isManagedRelay(endpoint) ? 'managed' : 'direct'
    ].join('|');
  }

  ignoreDuplicateConnect(endpoint, options) {
    if ((options && options.force) || this.probeOnly) return false;
    // 拨号中（connecting）或已连上（connected）时，同目标的重复 connect 一律忽略；
    // 真正需要重建的路径（换线路、前台恢复自检失败、网络切换）显式传 force。
    if ((this.state !== 'connecting' && this.state !== 'connected') || !this.connectAttempt) return false;
    const same = this.connectAttempt === this.connectSignature(endpoint, options);
    if (same) {
      try { console.log('[gateway] duplicate connect ignored: ' + this.endpoint); } catch (e) { /* 忽略 */ }
    }
    return same;
  }

  /** pairingCode 非空表示一次性配对握手；否则使用已保存的 Bearer 凭据。 */
  connect(endpoint, options) {
    const opts = options || {};
    if (this.ignoreDuplicateConnect(endpoint, opts)) return;
    // 记录拨号目标：内部 disconnect（换线路/取租赁）不清它，只有真正的
    // 失败/用户断开才清，避免拨号途中被重复触发拆掉。
    this.connectAttempt = this.connectSignature(endpoint, opts);
    this.lastConnectReason = (opts && opts.reason) || 'unknown';
    if (!accessApi.isManagedRelay(endpoint)) return this.connectTransport(endpoint, opts);
    // Only our hosted relay is metered. LAN/direct/self-hosted connections keep
    // their existing behavior and never depend on the account server.
    this.disconnect({ keepWant: false, deliberate: false });
    const generation = this.connectGeneration;
    if (!opts.relay || !opts.relay.nodeId) {
      this.setState('failed', uiText('请扫描 DSH 插件生成的公网配对二维码'));
      return;
    }
    this.endpoint = endpoint;
    this.lastConnectOpts = {
      token: opts.token || null,
      relay: Object.assign({}, opts.relay, {
        inviteToken: opts.relay.inviteToken || null,
        accessToken: opts.relay.accessToken || null
      })
    };
    // 已有仍在有效期内的公网租赁：直接开 socket。否则每次冷启动/重连都要先
    // wx.login + 两次 HTTPS 才轮到 connectSocket，体感就是"连接 DSH 很慢"。
    const cached = typeof accessApi.cachedLease === 'function' ? accessApi.cachedLease(opts.relay.nodeId) : null;
    if (cached) {
      this.connectTransport(endpoint, opts, cached);
      return;
    }
    this.setState('connecting', uiText('正在验证公网有效期…'));
    return accessApi.publicLease(opts.relay.nodeId, this.deviceId).then(lease => {
      if (generation !== this.connectGeneration) return;
      // 拿到新租赁即恢复"可自动刷新"的额度，供下一次服务端重启后重试。
      this._leaseRefreshTried = false;
      this.clearConnectionTimeout();
      publicAccessPrompt.promptFirstAuthorizedUse(() => {
        if (generation !== this.connectGeneration) return;
        this.connectTransport(endpoint, opts, lease);
      });
    }).catch(error => {
      if (generation !== this.connectGeneration) return;
      const message = error.message || uiText('公网授权验证失败；局域网不受影响');
      if (opts.pairingCode) {
        // 配对期拿不到公网租赁（未兑换/已到期/服务不可用）不是终止性错误：
        // 中继排在小程序候选链里，失败后要继续试局域网，否则没兑换的用户
        // 即使在同一局域网也连不上。
        this.wantsConnection = true;
        this.initPairingChain(endpoint, opts);
        this.handleTransportFailure(message, { pairingCodeConsumed: false });
        return;
      }
      const retryable = error && (error.code === 'NETWORK_ERROR' || error.code === 'SERVICE_ERROR');
      this.wantsConnection = !!retryable;
      this.setState('failed', message, error.code || null);
      if (retryable) this.scheduleReconnect();
    });
  }

  connectTransport(endpoint, options, serviceLease) {
    const opts = options || {};
    this.disconnect({ keepWant: false, deliberate: false });
    this.probeOnly = !!opts.probe;
    const rawEndpoint = String(endpoint || '');
    const endpointAuthority = rawEndpoint.split('://')[1] || '';
    const endpointHost = endpointAuthority.split('/')[0].replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const localWsDevelopment = /^ws:\/\//i.test(rawEndpoint) &&
      accessConfig.allowLocalWs === true && hosts.isLocalHost(endpointHost);
    // 诊断：记录实际拨号地址（不含 token），便于对照服务端 101/非 101 结果。
    try { console.log('[gateway] dial ' + rawEndpoint + ' reason=' + (this.lastConnectReason || 'unknown')); } catch (e) { /* 无 console 环境忽略 */ }
    // 先初始化候选链：ws:// 局域网候选被拒时要能继续回退到下一条线路（如托管中继）。
    this.endpoint = endpoint;
    this.initPairingChain(endpoint, opts);
    if (!/^wss:\/\//i.test(rawEndpoint) && !localWsDevelopment) {
      const message = uiText('元服务仅支持已在华为开发者中心配置域名的 wss:// 地址；本地调试请使用局域网地址');
      // 与小程序「拨号失败后换下一条线路」保持一致：配对候选链里还有候选时继续回退，
      // 而不是直接终止——否则中继被授权判定跳过后只剩局域网候选，连接会死在这里。
      if (this.pairingCode && this.pairingFallbacks.length) {
        this.wantsConnection = true;
        this.handleTransportFailure(message, { pairingCodeConsumed: false });
        return;
      }
      this.setState('failed', message);
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
      'X-DSH-Device-ID': this.deviceId,
      'X-DSH-Client-Type': runtime.clientKind()
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
    let earlyFailure = null;
    try {
      // ASCF 的 connectSocket 会把 protocols 数组序列化成非法头（中继回 400），
      // 而内部写 Sec-WebSocket-Protocol 又会被服务器回显、客户端却不认，
      // 于是握手后立刻 abnormal termination。
      // 方案：只用 protocols 声明主协议（可被服务器回显），凭据走自定义头，
      // 由中继（relay-server.js）从 X-DSH-* 头补全校验。
      const leaseToken = serviceLease && serviceLease.token ? String(serviceLease.token) : '';
      if (leaseToken) header['X-DSH-Public-Lease'] = leaseToken;
      if (serviceLease && opts.relay && opts.relay.authMode === 'gateway') header['X-DSH-Gateway-Auth'] = '1';
      if (opts.relay && opts.relay.inviteToken) header['X-DSH-Invite'] = opts.relay.inviteToken;
      if (opts.relay && opts.relay.accessToken) header['X-DSH-Access'] = opts.relay.accessToken;
      if (this.pairingCode && !(opts.relay && opts.relay.authMode === 'gateway')) header['X-DSH-Pair-Code'] = this.pairingCode;
      try { console.log('[gateway] negotiate dsh-mobile-v1 lease=' + (leaseToken ? 'yes' : 'no') + ' pair=' + (header['X-DSH-Pair-Code'] ? 'yes' : 'no') + ' gw=' + (header['X-DSH-Gateway-Auth'] || 'no')); } catch (e) { /* 无 console 环境忽略 */ }
      // 不传 protocols：ASCF 传了会写出非法头；服务器已改为只在客户端真正提供
      // Sec-WebSocket-Protocol 时才回显，因此这里不能声明协议。
      // 直连/局域网的首次配对：网关（0.8.x）只从 Sec-WebSocket-Protocol 或
      // query.pairingCode 读一次性配对码，X-DSH-Pair-Code 头会被忽略（401）。
      // ASCF 又不能在协议列表里带凭据，所以把配对码放进 query——否则局域网
      // 首次配对必然 401，重试几次就表现为「局域网连不上/反复重连」。
      let dialUrl = endpoint;
      if (!opts.relay && this.pairingCode) {
        const separator = String(endpoint).indexOf('?') >= 0 ? '&' : '?';
        dialUrl = endpoint + separator + 'pairingCode=' + encodeURIComponent(this.pairingCode);
      }
      const task = has.connectSocket({
        url: dialUrl,
        header: header,
        fail: function (err) {
          if (transportTask && self.socketTask !== transportTask) return;
          const message = socketErrorMessage(err, endpoint);
          // Some test/runtime shims may invoke fail before connectSocket returns.
          if (!transportTask) {
            earlyFailure = message;
            return;
          }
          self.handleTransportFailure(message);
        }
      });
      this.socketTask = task;
      transportTask = task;
      if (earlyFailure) {
        this.handleTransportFailure(earlyFailure);
        return;
      }
      if (!task || typeof task.onOpen !== 'function' || typeof task.onMessage !== 'function' ||
          typeof task.onError !== 'function' || typeof task.onClose !== 'function') {
        this.handleTransportFailure(uiText('无法建立 WebSocket 连接'));
        return;
      }
    } catch (e) {
      this.handleTransportFailure((e && e.message) || uiText('无法建立 WebSocket 连接'));
      return;
    }

    try {
      transportTask.onOpen(function () {
      try { console.log('[gateway] open'); } catch (e) {}
      if (self.socketTask !== transportTask || self.socketOpened) return;
      self.socketOpened = true;
      // 传输已建立：握手/鉴权阶段换回长超时（中继还要等连接器回拨网关）。
      self.startConnectionTimeout(REQUEST_TIMEOUT);
      if (serviceLease) {
        // 剩余有效期可能已经为 0（缓存租赁在拨号途中过期）：至少隔 5s 再刷新，
        // 否则会立刻重拨、形成毫秒级的「连上就重连」循环。
        self.publicLeaseTimer = setTimeout(() => {
          if (self.wantsConnection) self.connect(self.endpoint, Object.assign({}, self.lastConnectOpts, { force: true, reason: 'lease-refresh' }));
        }, Math.max(5000, serviceLease.expiresAt - Date.now()));
      }
      if (self.relayMeta) {
        // Each connection waits for its own secure random material.
        const relay = self.relayMeta;
        const generation = self.connectGeneration;
        const isCurrent = () => self.socketTask === transportTask &&
          self.connectGeneration === generation && self.relayMeta === relay && self.state === 'connecting';
        ClientSession.create(relay.nodeId, relay.agentPubKey).then(session => {
          if (!isCurrent()) {
            session.ephemeral.secretKey.fill(0);
            return;
          }
          self.relaySession = session;
          try {
            transportTask.send({
              data: toArrayBuffer(session.hello),
              fail: function () { if (isCurrent()) self.handleTransportFailure(uiText('E2EE 握手发送失败')); }
            });
          } catch (e) {
            if (isCurrent()) self.handleTransportFailure(uiText('E2EE 握手发送失败'));
          }
        }, () => {
          if (isCurrent()) self.handleAuthorizationFailure(uiText('无法安全初始化加密会话，请检查系统随机数能力'));
        });
        return;
      }
      self.setState('connected');
      });
      transportTask.onMessage(function (res) {
      if (self.socketTask !== transportTask) return;
      self.lastInboundAt = Date.now();
      if (self.relayMeta) {
        self.handleRelayMessage(res.data);
        return;
      }
      self.handleFrame(res.data);
      });
      transportTask.onError(function (err) {
      if (self.socketTask !== transportTask) return;
      self.handleTransportFailure(socketErrorMessage(err, endpoint));
      });
      transportTask.onClose(function (res) {
      try { console.log('[gateway] close ' + JSON.stringify(res || {})); } catch (e) {}
      if (self.socketTask !== transportTask) return;
      if (self.state === 'connected' || self.state === 'connecting') {
        if (res && Number(res.code) === 4003) {
          if (self.pairingCode) {
            // 配对期：刚取到的租赁就被拒（多为服务端重启 token 作废）或公网授权不通过。
            // 二维码里还有局域网候选，继续候选链，不终止。
            self.noteAuthorizationFailure(res.reason === 'public-lease-expired'
              ? uiText('公网授权已失效，正在尝试其他线路')
              : (/^public-access-/.test(res.reason || '')
                  ? uiText('公网服务未开通、已到期或验证失败，请在设置→公网访问检查或兑换；局域网不受影响')
                  : uiText('设备配对已失效，请重新扫描 DSH 二维码')));
          } else if (res.reason === 'public-lease-expired') { self.refreshManagedLease(uiText('正在刷新公网授权')); }
          else if (/^public-access-/.test(res.reason || '')) self.refreshManagedLease(uiText('公网服务未开通、已到期或验证失败，请在设置→公网访问检查或兑换；局域网不受影响'));
          else {
            // 已保存凭据的重连被中继拒掉，但 reason 不在上面两种之列。中继的租赁只存在
            // 服务端内存里，重启/续期边界上它会用各种 reason 关连接；这里一律按租赁问题
            // 走刷新重试。refreshManagedLease 内部会判断是不是托管中继、并且只重试一次，
            // 所以自建中继/直连的行为不变（仍然终止并显示原因），不会死循环。
            self.refreshManagedLease(/^public-access-/.test(res.reason || '')
              ? uiText('公网服务未开通、已到期或验证失败，请在设置→公网访问检查或兑换；局域网不受影响')
              : uiText('正在刷新公网授权'));
          }
        } else if (res && Number(res.code) === 4001) {
          if (String(res.reason || '') === 'gateway-closed') {
            // 连接器主动拆掉桥接（本地网关 ws 关闭后中继统一以 4001 gateway-closed
            // 通知手机）。这通常是瞬时的：快速重建即可，不该显示成「离线」。
            self.handleBridgeTeardown();
          } else {
            // The desktop connector may be starting or temporarily offline. Keep the
            // actionable status visible, but retry saved credentials with backoff.
            self.noteAuthorizationFailure(
              uiText('电脑端的公网连接器已离线，请在 DSH 中重新开启「微信连接」后重试'),
              { retryable: true }
            );
          }
        } else if (res && Number(res.code) === 4004) {
          self.noteAuthorizationFailure(uiText('DSH 电脑端连接器未支持安全公网配对，请升级插件连接器'));
        } else {
          self.handleTransportFailure(uiText('连接已关闭'));
        }
      }
      });

      // 配对中的直连候选（lan/public）用短超时：不可达地址不拖慢「换下一条线路」。
      // 中继候选与已保存凭据的重连保持长超时。
      if (this.socketTask === transportTask && !this.socketOpened && this.state === 'connecting') {
        this.startConnectionTimeout(this.pairingCode && !opts.relay ? PAIRING_CONNECT_TIMEOUT : REQUEST_TIMEOUT);
      }
    } catch (e) {
      if (this.socketTask === transportTask) {
        this.handleTransportFailure((e && e.message) || uiText('无法建立 WebSocket 连接'));
      }
    }
  }

  /**
   * 初始化配对候选链：一次性配对码、回退候选（含中继元信息与线路族）。
   * connectTransport 与托管中继取租赁失败的路径共用——后者也要能继续回退，
   * 否则「没兑换公网」会把局域网候选一起堵死。
   *
   * 调用约定（store 两侧都按此传参）：candidateKinds 含首选（首项即 routeKind），
   * endpointCandidates / relayCandidates 是回退候选、不含首选，二者同序对齐；
   * 候选列表已由选路层去重。任一侧缺失或长度不符时，对应候选的线路族/中继元信息
   * 记为 null——不影响连接本身，只影响提示与回退参数。
   */
  initPairingChain(endpoint, opts) {
    this.pairingCode = opts.pairingCode || null;
    this.routeKind = opts.routeKind || null;
    this.candidateKinds = opts.routeKind && Array.isArray(opts.candidateKinds) && opts.candidateKinds.length
      ? opts.candidateKinds.slice()
      : null;
    this.pairingFallbacks = this.pairingCode && Array.isArray(opts.endpointCandidates)
      ? opts.endpointCandidates.filter(candidate => candidate && candidate !== endpoint).slice(0, 15)
      : [];
    // 回退候选的中继元信息：中继候选的认证模型与直连不同，回退时必须把 relay
    // 元信息一起带下去，否则中继候选连不上。
    const fallbackKinds = Array.isArray(opts.candidateKinds) ? opts.candidateKinds.slice(1) : [];
    const fallbackRelays = Array.isArray(opts.relayCandidates) ? opts.relayCandidates : [];
    this.pairingFallbackKinds = this.pairingFallbacks.map((item, index) => (
      fallbackKinds.length === this.pairingFallbacks.length ? fallbackKinds[index] : null
    ));
    this.pairingFallbackRelays = this.pairingFallbacks.map((item, index) => (
      fallbackRelays.length === this.pairingFallbacks.length ? fallbackRelays[index] : null
    ));
    // 全部候选的线路族：判定「二维码是否只含局域网」要用完整集合，回退链变短后
    // 不能丢掉这个信息，所以由首次尝试贯穿整条回退链。
    this.pairingAllKinds = opts.allCandidateKinds || this.candidateKinds;
    this.socketOpened = false;
  }

  startConnectionTimeout(duration) {
    const self = this;
    this.clearConnectionTimeout();
    const generation = this.connectGeneration;
    const socket = this.socketTask;
    const token = {};
    this.timeoutToken = token;
    this.timeoutTimer = setTimeout(function () {
      if (self.timeoutToken !== token || self.connectGeneration !== generation ||
          self.socketTask !== socket || self.state !== 'connecting') return;
      self.timeoutTimer = null;
      self.timeoutToken = null;
      self.handleTransportFailure(uiText('连接超时'));
    }, duration || REQUEST_TIMEOUT);
  }

  clearConnectionTimeout() {
    const timer = this.timeoutTimer;
    this.timeoutTimer = null;
    this.timeoutToken = null;
    if (timer !== null) clearTimeout(timer);
  }

  handleTransportFailure(message, options) {
    const pairingOutcomeUnknown = !(options && options.pairingCodeConsumed === false);
    clearTimeout(this.publicLeaseTimer);
    this.publicLeaseTimer = null;
    this.clearConnectionTimeout();
    this.clearStableReset();
    this.connectAttempt = null;
    const wasDeliberate = !this.wantsConnection;
    // 诊断：断链原因 + 本次连接存活时长，便于对照网关/中继日志排查反复重连。
    try {
      console.log('[gateway] transport failure: ' + message + ' (up ' +
        (this.connectedAt ? Math.round((Date.now() - this.connectedAt) / 1000) + 's' : '0s') + ')');
    } catch (e) { /* 无 console 环境忽略 */ }
    const socket = this.socketTask;
    this.socketTask = null;
    if (socket) {
      try { socket.close({}); } catch (e) { /* 忽略 */ }
    }
    this.failAllPending(message);
    this.settleDeviceForget(new Error(message));
    if (wasDeliberate) {
      this.setState('disconnected', null, null, true);
      return;
    }
    // 保留未确认的配对码；服务端可能已消费但确认帧丢失。
    if (this.pairingCode) {
      const nextEndpoint = this.pairingFallbacks.shift();
      const nextKind = this.pairingFallbackKinds ? this.pairingFallbackKinds.shift() : null;
      const nextRelay = this.pairingFallbackRelays ? this.pairingFallbackRelays.shift() : null;
      if (nextEndpoint) {
        const pairingCode = this.pairingCode;
        const endpointCandidates = this.pairingFallbacks.slice();
        const candidateKinds = (nextKind ? [nextKind] : []).concat(this.pairingFallbackKinds || []);
        // 剩余候选的中继元信息要继续往下传：否则再下一次回退就丢了 E2EE 元信息。
        const relayCandidates = this.pairingFallbackRelays ? this.pairingFallbackRelays.slice() : null;
        const generation = this.connectGeneration;
        const allCandidateKinds = this.pairingAllKinds;
        this.wantsConnection = false;
        this.setState('connecting', uiText('当前线路不可达，正在尝试其他配对地址…'));
        setTimeout(() => {
          if (this.connectGeneration !== generation || this.state !== 'connecting') return;
          this.connect(nextEndpoint, { pairingCode, endpointCandidates, relayCandidates, routeKind: nextKind, candidateKinds, allCandidateKinds, relay: nextRelay || undefined });
        }, 0);
        return;
      }
      this.wantsConnection = false;
      // 只有局域网候选时，「重新扫码」解决不了问题：要点明二维码里没有公网地址。
      const kinds = this.pairingAllKinds && this.pairingAllKinds.length
        ? this.pairingAllKinds
        : (this.candidateKinds && this.candidateKinds.length
            ? this.candidateKinds
            : (this.routeKind ? [this.routeKind] : []));
      const lanOnly = routeTable.onlyLocalAreaNetwork(kinds.map(kind => ({ kind })));
      // 取公网租赁失败等原因下配对码还有效：别误导用户「码失效了，重新扫码」。
      this.setState('failed', message
        + (pairingOutcomeUnknown ? uiText('，配对状态未确认，请重试或重新扫码') : '')
        + (lanOnly ? uiText('。这张二维码只包含局域网地址，手机在外网时连不上：请在 DSH 插件里配置公网地址或中继，再重新生成二维码') : ''));
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

  /**
   * 授权类失败（中继拒绝、连接器离线、版本过旧、E2EE 验签不通过）：
   * 配对期内二维码里还有局域网候选，不能终止——继续候选链；
   * 已保存凭据的重连保持原语义：直接把原因显示出来，不悄悄换线。
   */
  noteAuthorizationFailure(message, options) {
    if (this.pairingCode) {
      this.handleTransportFailure(message, { pairingCodeConsumed: false });
      return;
    }
    if (options && options.retryable) {
      this.handleRetryableAuthorizationFailure(message);
      return;
    }
    this.handleAuthorizationFailure(message);
  }

  handleRetryableAuthorizationFailure(message) {
    clearTimeout(this.publicLeaseTimer);
    this.publicLeaseTimer = null;
    this.clearConnectionTimeout();
    this.clearStableReset();
    this.connectAttempt = null;
    const socket = this.socketTask;
    this.socketTask = null;
    if (socket) {
      try { socket.close({}); } catch (e) { /* 忽略 */ }
    }
    this.failAllPending(message);
    this.settleDeviceForget(new Error(message));
    if (!this.wantsConnection) {
      this.setState('disconnected', null, null, true);
      return;
    }
    this.setState('failed', message);
    this.scheduleReconnect();
  }

  handleAuthorizationFailure(message) {
    clearTimeout(this.publicLeaseTimer);
    this.publicLeaseTimer = null;
    this.clearConnectionTimeout();
    this.clearStableReset();
    this.connectAttempt = null;
    this.wantsConnection = false;
    const socket = this.socketTask;
    this.socketTask = null;
    if (socket) {
      try { socket.close({}); } catch (e) { /* 忽略 */ }
    }
    this.failAllPending(message);
    this.settleDeviceForget(new Error(message));
    this.setState('failed', message);
  }

  /**
   * 中继判定公网授权不通过（4003 public-access-* / public-lease-expired）：
   * 服务端的租赁只存在内存里，服务端一重启旧 token 就作废，而本机凭据会一直缓存到过期，
   * 于是同一个死 token 反复重连永远失败（换手机/清缓存后才正常）。
   * 这里丢掉缓存、用新租赁重试一次；第二次仍失败才把原因显示给用户，避免死循环。
   */
  refreshManagedLease(message) {
    clearTimeout(this.publicLeaseTimer);
    this.publicLeaseTimer = null;
    this.clearConnectionTimeout();
    this.clearStableReset();
    this.connectAttempt = null;
    const socket = this.socketTask;
    this.socketTask = null;
    if (socket) {
      try { socket.close({}); } catch (e) { /* 忽略 */ }
    }
    this.failAllPending(message);
    const managed = typeof accessApi.isManagedRelay === 'function' && accessApi.isManagedRelay(this.endpoint);
    if (!managed || this._leaseRefreshTried) {
      this.wantsConnection = false;
      this.setState('failed', message);
      return;
    }
    this._leaseRefreshTried = true;
    if (typeof accessApi.forgetGrant === 'function') accessApi.forgetGrant();
    // disconnect 会 +1 generation 并清掉重连计时器，随后的 connect() 走"无缓存"分支重新取号。
    this.disconnect({ keepWant: false, deliberate: false });
    this.wantsConnection = true;
    this.setState('connecting', uiText('正在刷新公网授权'));
    const self = this;
    setTimeout(function () {
      if (!self.wantsConnection || !self.endpoint) return;
      self.connect(self.endpoint, Object.assign({}, self.lastConnectOpts || { token: self.lastToken || null }, { reason: 'lease-refresh' }));
    }, 0);
  }

  /**
   * 连接器主动拆桥（4001 gateway-closed）：本地网关 ws 关闭后中继统一用它通知手机。
   * 这是瞬时事件，快速重建即可；频率过高才退回退避，避免自己把自己打成重连风暴。
   */
  handleBridgeTeardown() {
    clearTimeout(this.publicLeaseTimer);
    this.publicLeaseTimer = null;
    this.clearConnectionTimeout();
    this.clearStableReset();
    this.connectAttempt = null;
    const socket = this.socketTask;
    this.socketTask = null;
    if (socket) {
      try { socket.close({}); } catch (e) { /* 忽略 */ }
    }
    this.failAllPending(uiText('连接已重建'));
    if (!this.wantsConnection) {
      this.setState('disconnected', null, null, true);
      return;
    }
    const now = Date.now();
    if (!this.bridgeTeardownWindow || now - this.bridgeTeardownWindow > 30000) {
      this.bridgeTeardownWindow = now;
      this.bridgeTeardowns = 0;
    }
    this.bridgeTeardowns = (this.bridgeTeardowns || 0) + 1;
    const delay = this.bridgeTeardowns <= 6 ? 800 : this.reconnectDelay(this.reconnectAttempts + 1);
    try { console.log('[gateway] bridge closed by connector; reconnect in ' + delay + 'ms'); } catch (e) { /* 忽略 */ }
    this.setState('connecting', uiText('正在重新连接…'));
    const self = this;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(function () {
      self.reconnectTimer = null;
      if (self.wantsConnection && self.endpoint) {
        self.connect(self.endpoint, Object.assign({}, self.lastConnectOpts, { force: true, reason: 'bridge-teardown' }));
      }
    }, delay);
  }

  /** 第 n 次重连的等待时间：指数退避 + ±RECONNECT_JITTER 抖动（可单测）。 */
  reconnectDelay(attempts) {
    const exponent = Math.max(0, Math.min(30, (attempts || 1) - 1));
    const base = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, exponent), RECONNECT_MAX_DELAY);
    const jitter = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER;
    return Math.max(RECONNECT_BASE_DELAY, Math.round(base * jitter));
  }

  scheduleReconnect() {
    if (!this.wantsConnection || this.reconnectTimer || this.probeOnly) return;
    const self = this;
    this.reconnectAttempts += 1;
    const delay = this.reconnectDelay(this.reconnectAttempts);
    try { console.log('[gateway] reconnect #' + this.reconnectAttempts + ' in ' + delay + 'ms'); } catch (e) { /* 忽略 */ }
    this.reconnectTimer = setTimeout(function () {
      self.reconnectTimer = null;
      if (self.wantsConnection && self.endpoint) {
        self.connect(self.endpoint, Object.assign({}, self.lastConnectOpts || { token: self.lastToken || null }, { reason: 'reconnect' }));
      }
    }, delay);
  }

  disconnect(options) {
    this.connectGeneration = (this.connectGeneration || 0) + 1;
    clearTimeout(this.publicLeaseTimer);
    this.publicLeaseTimer = null;
    const keepWant = options && options.keepWant;
    const deliberate = !(options && options.deliberate === false);
    this.wantsConnection = !!keepWant;
    this.clearConnectionTimeout();
    this.clearStableReset();
    // 内部重建（换线路/取租赁）保留 connectAttempt，让拨号途中的重复触发被忽略；
    // 用户主动断开则清空，下一次 connect 一定会重新拨号。
    if (deliberate) this.connectAttempt = null;
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
    this.pairingFallbacks = [];
    this.pairingFallbackKinds = [];
    this.pairingFallbackRelays = [];
    this.pairingAllKinds = null;
    this.candidateKinds = null;
    this.routeKind = null;
    this.socketOpened = false;
    this.relaySession = null;
    this.relayMeta = null;
    this.relayAccessToken = null;
    this.failAllPending(uiText('连接已断开'));
    this.settleDeviceForget(new Error(uiText('连接已断开')));
    this.setState('disconnected', null, null, deliberate);
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
      const reason = session.lastOpenFailure;
      // 诊断：密文帧被拒的形态（长度/首字节/计数），便于区分「中继控制帧/残帧」
      // 「重复帧」与真正的会话密钥不一致——这张日志是排查「反复重连」的关键线索。
      try {
        let hex = '';
        let ascii = '';
        for (let i = 0; i < Math.min(bytes.length, 24); i += 1) {
          hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16) + ' ';
          ascii += bytes[i] >= 32 && bytes[i] < 127 ? String.fromCharCode(bytes[i]) : '.';
        }
        console.log('[gateway] relay frame rejected: len=' + bytes.length + ' head=' + (bytes.length ? bytes[0] : -1) +
          ' counter=' + session.packetCounter(bytes) + ' rx=' + session.rxCounter + ' reason=' + reason +
          ' hex=' + hex.trim() + ' ascii=' + ascii);
      } catch (e) { /* 忽略 */ }
      // 非密文包（中继控制帧、被拆分的残片）和重复帧都不代表会话密钥坏了：
      // 直接丢弃即可，绝不能因此断开整条连接——否则一个杂帧就会触发一次重连，
      // 表现就是「点开会话/看会话时掉线」。
      if (reason === 'format' || reason === 'duplicate' || reason === 'not-ready') return;
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

  forgetDevice(timeoutMs) {
    if (this.state !== 'connected') return Promise.reject(new Error(uiText('网关尚未连接')));
    if (this.deviceForgetPending) return Promise.reject(new Error(uiText('设备移除请求正在处理中')));
    const requestId = util.uuid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.deviceForgetPending = null;
        reject(new Error(uiText('主机未确认移除设备')));
      }, Number.isFinite(timeoutMs) ? timeoutMs : 5000);
      this.deviceForgetPending = { requestId, resolve, reject, timer };
      if (!this.send({ type: 'device-forget', requestId })) {
        this.settleDeviceForget(new Error(uiText('设备移除请求发送失败')));
      }
    });
  }

  settleDeviceForget(error, frame) {
    const pending = this.deviceForgetPending;
    if (!pending) return;
    this.deviceForgetPending = null;
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(frame);
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
    if (frame.kind === 'paired') {
      this.lastToken = frame.token || null;
      if (this.lastToken) {
        this.pairingCode = null;
        this.pairingFallbacks = [];
        this.lastConnectOpts.token = this.lastToken;
      }
      if (this.cb.onPaired) this.cb.onPaired(frame);
    }

    if (frame.kind === 'device-forgotten' && this.deviceForgetPending &&
        frame.requestId === this.deviceForgetPending.requestId) {
      this.settleDeviceForget(null, frame);
      return;
    }
    if (frame.kind === 'error' && frame.requestType === 'device-forget' && this.deviceForgetPending &&
        (!frame.requestId || frame.requestId === this.deviceForgetPending.requestId)) {
      this.settleDeviceForget(new Error(frame.message || uiText('设备移除失败')));
      return;
    }

    if (frame.kind === 'relay-auth-error') {
      this.noteAuthorizationFailure(frame.message || uiText('配对码或设备凭据无效，请重新扫码'));
      return;
    }
    if (frame.kind === 'hello' && this.relayMeta && this.relayMeta.authMode === 'gateway' && this.state === 'connecting') {
      this.setState('connected');
      this.reportDeviceInfo();
    }

    if (frame.kind === 'relay-authorized') {
      // 授权通过：本次租赁是好的，下次遇到 4003 仍允许自动刷新一次。
      this._leaseRefreshTried = false;
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
    const uploadKey = frame.requestId && 'upload:' + frame.requestId;
    const upload = uploadKey && this.pendingRequests[uploadKey];
    if (upload) {
      if (frame.kind !== 'error' && frame.kind !== upload.expectedKind) return;
      delete this.pendingRequests[uploadKey]; clearTimeout(upload.timer);
      if (frame.kind === 'error') upload.reject(new Error(frame.message || frame.code || uiText('文件上传失败，草稿已保留')));
      else if (frame.sessionId !== upload.sessionId) upload.reject(new Error(uiText('文件上传响应无效')));
      else upload.resolve(frame);
      return;
    }
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
      const unknown = /^unknown message type: (plugin-market-(?:indexes|set-indexes|search)|plugin-credential-(?:describe|set)|plugin-translation-limits|plugin-uninstall)$/.exec(frame.message);
      if (unknown) {
        for (const key of Object.keys(this.pendingRequests)) {
          const pending = this.pendingRequests[key];
          if (key.indexOf('plugin:') === 0 && pending.expectedKind === unknown[1]) {
            delete this.pendingRequests[key]; clearTimeout(pending.timer);
            pending.reject(new Error(uiText(unknown[1].indexOf('plugin-market-') === 0 ? '当前网关未提供插件市场接口，请更新网关后重试' : unknown[1] === 'plugin-uninstall' ? '当前网关未提供卸载接口，请更新网关或改用电脑端 DSH 卸载' : '当前网关尚未开放此功能，请更新网关后重试。')));
          }
        }
        return;
      }
    }
    // Install events reuse the request ID, but only the final reply settles it.
    const pluginKey = frame.requestId && 'plugin:' + frame.requestId;
    const pluginRequest = pluginKey && this.pendingRequests[pluginKey];
    if (pluginRequest) {
      if (frame.kind === pluginRequest.expectedKind || (Array.isArray(pluginRequest.expectedKind) && pluginRequest.expectedKind.indexOf(frame.kind) >= 0) || frame.kind === 'error') {
        delete this.pendingRequests[pluginKey];
        clearTimeout(pluginRequest.timer);
        if (frame.kind === 'error') pluginRequest.reject(Object.assign(new Error(frame.message || frame.code || uiText('插件请求失败')), { code: frame.code }));
        else pluginRequest.resolve(frame);
      }
      return;
    }
    const accountKey = frame.requestId && 'account:' + frame.requestId;
    const accountRequest = accountKey && this.pendingRequests[accountKey];
    if (accountRequest && (frame.kind === accountRequest.expectedKind || frame.kind === 'error')) {
      delete this.pendingRequests[accountKey];
      clearTimeout(accountRequest.timer);
      if (frame.kind === 'error') accountRequest.reject(Object.assign(new Error(frame.message || frame.code || uiText('账号信息读取失败')), { code: frame.code }));
      else accountRequest.resolve(frame);
      return;
    }
    const clawbotKey = frame.requestId && 'clawbot:' + frame.requestId;
    const clawbotRequest = clawbotKey && this.pendingRequests[clawbotKey];
    if (clawbotRequest && (frame.kind === clawbotRequest.expectedKind || frame.kind === 'error')) {
      delete this.pendingRequests[clawbotKey];
      clearTimeout(clawbotRequest.timer);
      if (frame.kind === 'error') clawbotRequest.reject(Object.assign(new Error(frame.message || frame.code || uiText('ClawBot 请求失败')), { code: frame.code }));
      else clawbotRequest.resolve(frame);
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
    // pong 关联到 ping（store 前台自检用 type:ping，心跳用 matchType=pong 的独立 lane）
    if (frame.kind === 'pong') {
      Object.keys(this.pendingRequests).forEach(key => {
        const pendingPing = this.pendingRequests[key];
        if (!pendingPing) return;
        if (key !== 'type:ping' && pendingPing.expectedKind !== 'pong') return;
        delete this.pendingRequests[key];
        clearTimeout(pendingPing.timer);
        pendingPing.resolve(frame);
      });
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
      // key 可显式指定：心跳用自己的 lane，避免与 store 前台 ping 的
      // 「同类型请求只能有一个在途」互相取代、把好连接判成无响应。
      const key = opts.key || (opts.rpcId ? 'rpc:' + opts.rpcId : 'type:' + (opts.matchType || object.type));
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

  ping(timeout) { return this.request({ type: 'ping' }, { matchType: 'ping', timeout: timeout || REQUEST_TIMEOUT }); }

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
  // view=summary：网关只回标题等列表字段，不回每会话的完整 projections
  // （那占整帧 ~92%，中继线路上首页要等 2.7MB 才能出列表）。
  requestSessions() { return this.request({ type: 'sessions', view: 'summary' }); }
  requestHost() { return this.request({ type: 'host' }); }
  requestAccount(client) {
    const requestId = util.uuid();
    return new Promise((resolve, reject) => {
      if (!this.send({ type: 'account', requestId, client })) {
        reject(new Error(uiText('WebSocket 尚未连接')));
        return;
      }
      const key = 'account:' + requestId;
      const timer = setTimeout(() => {
        delete this.pendingRequests[key];
        reject(new Error(uiText('账号信息读取超时')));
      }, REQUEST_TIMEOUT);
      this.pendingRequests[key] = { resolve, reject, timer, key, expectedKind: 'account' };
    });
  }
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

  /** 会话上下文面板：宿主 mobileContext 投影 + 官方 breakdown/usage/stats。 */
  requestContextDashboard(sessionId) {
    return this.request({ type: 'context-dashboard', sessionId: sessionId });
  }

  /** 按需读取上下文浏览器中单个 surface/header 事件的正文。 */
  requestContextContent(sessionId, seq) {
    return this.request({ type: 'context-content', sessionId: sessionId, seq: seq });
  }

  /** 会话编队（当前 Agent 家族网络）：宿主 context-fleet 请求。 */
  requestContextFleet(sessionId) {
    return this.request({ type: 'context-fleet', sessionId: sessionId });
  }

  /** 跨会话上下文汇总（Context Insights 页）：宿主 context-insights 请求。 */
  requestContextInsights(sessionId) {
    return this.request({ type: 'context-insights', sessionId: sessionId });
  }

  /** 跨 Agent 通讯扫描（编队通讯面板）：宿主 context-comms 请求。 */
  requestContextComms(sessionIds, sessions, members) {
    // 子 Agent 会话需要 durable parent address + mode 才能读到日志；rc.3 的
    // send_message 用成员名做收件人，名册（id/name）供宿主解析回会话 id。
    const payload = { type: 'context-comms', sessionIds: Array.isArray(sessionIds) ? sessionIds : [] };
    if (Array.isArray(sessions) && sessions.length) payload.sessions = sessions;
    if (Array.isArray(members) && members.length) {
      payload.members = members.slice(0, 40).filter(member => member && typeof member.id === 'string'
        && typeof member.name === 'string' && member.id && member.name)
        .map(member => ({ id: member.id, name: member.name }));
    }
    return this.request(payload);
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

  requestUpload(action, payload) {
    const kinds = { open: 'file-upload-opened', chunk: 'file-upload-chunk-accepted', finish: 'file-upload-completed', cancel: 'file-upload-cancelled', message: 'sent' };
    if (!kinds[action]) return Promise.reject(new Error('Invalid upload action'));
    const object = Object.assign({}, payload, { type: action === 'message' ? 'message' : 'file-upload-' + action, requestId: util.uuid() });
    const key = 'upload:' + object.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { delete this.pendingRequests[key]; reject(new Error(uiText('上传或发送超时，请核对会话后重试'))); }, action === 'finish' || action === 'message' ? 60000 : 30000);
      this.pendingRequests[key] = { resolve, reject, timer, expectedKind: kinds[action], sessionId: object.sessionId };
      if (!this.send(object)) { delete this.pendingRequests[key]; clearTimeout(timer); reject(new Error(uiText('请先连接网关后重试'))); }
    });
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

  requestHistory(sessionId, beforeSeq, historyFormatVersion, maxBytesOverride) {
    // 对齐 dsh-mobile v1.7.5 的会话视图分页：限制消息数和字节数，
    // 避免旧会话一次读取过大而在 Host 查询阶段超时。
    // 局域网/直连首屏用 2 MiB / 60 条；本地缓存已先渲染，权威内容再无缝补齐。
    // 旧页直连用 2 MiB / 40 条；公网中继的首屏和分页在下方单独限额。
    const tail = beforeSeq === undefined || beforeSeq === null;
    // 公网中继下整包要经 E2EE 加密后单帧转发；移动端解密大帧会阻塞首屏。
    // 首屏进一步压到 12 条 / 128KB，先呈现最新记录；向上翻页仍保留 256KB。
    const relay = !!this.relayMeta;
    // 局域网/直连也别一次要 2 MiB：超大单帧在手机 WebSocket 上容易触发
    // 收包失败，表现就是「点开会话就断开」。先取小尾巴，往上滑再分页补齐。
    const defaultMaxBytes = relay ? (tail ? 128 * 1024 : 256 * 1024) : (tail ? 256 * 1024 : 512 * 1024);
    const requestedMaxBytes = Number(maxBytesOverride);
    const payload = {
      type: 'history',
      sessionId: sessionId,
      maxMessages: tail ? (relay ? 12 : 30) : 40,
      maxBytes: Number.isSafeInteger(requestedMaxBytes)
        ? Math.min(2 * 1024 * 1024, Math.max(defaultMaxBytes, requestedMaxBytes))
        : defaultMaxBytes,
      view: 'conversation'
    };
    const parent = this.sessionParents[sessionId];
    if (parent && parent.parentSessionId) {
      payload.parentSessionId = parent.parentSessionId;
      if (parent.mode) payload.mode = parent.mode;
    }
    if (beforeSeq !== undefined && beforeSeq !== null && beforeSeq >= 0 && historyFormatVersion) {
      payload.beforeSeq = beforeSeq;
      payload.historyFormatVersion = historyFormatVersion;
    }
    return this.send(payload);
  }

  /**
   * 预览任意会话的记录。子智能体（subagent）会话必须带持久父地址，
   * 否则网关以 session/agent-busy 拒绝且错误帧无 sessionId，只能等超时。
   * @param sessionId 目标会话（子智能体时为子会话 id）
   * @param parent 可选 { parentSessionId, mode }，来自 subagentCatalog
   */
  inspectSession(sessionId, parent) {
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
      const parentSessionId = parent && typeof parent.parentSessionId === 'string' ? parent.parentSessionId.trim() : '';
      const mode = parent && typeof parent.mode === 'string' ? parent.mode.trim() : '';
      if (!this.send({type:'history',sessionId,maxMessages:20,maxBytes:256*1024,view:'conversation',
        ...(parentSessionId ? {parentSessionId} : {}),
        ...(parentSessionId && ['one-shot','continuable','unknown'].includes(mode) ? {mode} : {})})) {
        delete this.pendingRequests[key]; clearTimeout(pending.timer); reject(new Error(uiText('请先连接网关')));
      }
    });
    if (this.pendingRequests[key]) this.pendingRequests[key].promise = promise;
    return promise;
  }

  /** 取消未完成的 inspector 请求，避免超时后阻塞再次查看。 */
  cancelInspector(sessionId) {
    const key = 'inspector:' + sessionId;
    const pending = this.pendingRequests[key];
    if (!pending) return false;
    if (pending.timer) clearTimeout(pending.timer);
    pending.resolve = () => {};
    pending.reject = () => {};
    delete this.pendingRequests[key];
    return true;
  }

  /** 登记子 Agent 会话的 durable parent，后续 subscribe/history 自动带上。 */
  setSessionParent(sessionId, parent) {
    const id = sessionId ? String(sessionId) : '';
    if (!id) return;
    const parentSessionId = parent && typeof parent.parentSessionId === 'string' ? parent.parentSessionId.trim() : '';
    if (!parentSessionId) { delete this.sessionParents[id]; return; }
    const rawMode = parent && typeof parent.mode === 'string' ? parent.mode.trim() : '';
    const mode = ['one-shot', 'continuable', 'unknown'].includes(rawMode) ? rawMode : 'unknown';
    this.sessionParents[id] = { parentSessionId, mode };
  }

  requestAttachment(sessionId, attachmentId) {
    return this.request({ type: 'attachment', sessionId: sessionId, attachmentId: attachmentId });
  }

  subscribe(sessionId, afterSeq) {
    this.activeSessionId = sessionId || null;
    if (sessionId) {
      // 订阅快照别一次性塞满 1 MiB：中继要整包加密后单帧转发，手机端
      // WebSocket 处理超大单帧也容易出问题（点开会话就掉线的来源之一）。
      // 统一声明一个小预算：先拿到最新一小段立即可见，旧记录由上滑分页补。
      const snapshotMaxBytes = 160 * 1024;
      const parent = this.sessionParents[sessionId];
      return this.send({ type: 'subscribe', sessionId: sessionId, assistantStream: true,
        ...(Number.isSafeInteger(afterSeq) && afterSeq >= 0 ? { afterSeq: afterSeq } : {}),
        ...(snapshotMaxBytes ? { snapshotMaxBytes } : {}),
        ...(parent && parent.parentSessionId ? { parentSessionId: parent.parentSessionId } : {}),
        ...(parent && parent.parentSessionId && parent.mode ? { mode: parent.mode } : {}) });
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

  /** images: [{ mediaType, data(base64), name }], attachments: workspace refs */
  sendMessage(text, sessionId, workspaceId, images, mode, notificationTicket, attachments) {
    const payload = {
      type: 'message',
      text: text,
      images: (images || []).map(function (img) {
        return { mediaType: img.mediaType, data: img.data, name: img.name || null };
      }),
      attachments: (attachments || []).map(function (item) {
        return { kind: item.kind === 'directory' ? 'directory' : 'file', path: item.path, name: item.name || null };
      }),
      clientTimeZone: this.timeZone()
    };
    // An omitted mode is a normal immediate message. Only add queue/steer
    // when the caller explicitly requests an in-flight conversation action.
    if (mode) payload.mode = mode;
    if (typeof notificationTicket === 'string' && /^[A-Za-z0-9_-]{43}$/.test(notificationTicket)) payload.notificationTicket = notificationTicket;
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

  /** Gateway-owned ClawBot controls use a separate protocol from plugin RPC. */
  requestClawbot(payload) {
    const object = Object.assign({}, payload || {}, { type: 'clawbot-control' });
    object.requestId = object.requestId || util.uuid();
    const key = 'clawbot:' + object.requestId;
    return new Promise((resolve, reject) => {
      if (this.pendingRequests[key]) { reject(new Error(uiText('ClawBot 请求正在进行'))); return; }
      const timer = setTimeout(() => {
        delete this.pendingRequests[key];
        reject(new Error(uiText('ClawBot 请求超时，请刷新状态后重试')));
      }, 30000);
      this.pendingRequests[key] = { resolve, reject, timer, key, expectedKind: 'clawbot-control' };
      if (!this.send(object)) {
        clearTimeout(timer);
        delete this.pendingRequests[key];
        reject(new Error(uiText('连接网关后才能管理 ClawBot')));
      }
    });
  }

  // ---------- 插件管理（对齐 dsh-mobile v1.7.x plugin protocol） ----------

  requestPlugin(type, payload, timeout) {
    const object = Object.assign({}, payload || {}, { type: type });
    object.requestId = object.requestId || util.uuid();
    const expectedKind = { 'plugin-inspect': 'plugin-inspection', 'plugin-install': 'plugin-install-result', 'plugin-uninstall': ['plugin-uninstall-result', 'plugin-uninstalled', 'plugin-removed'], 'speech-configure': 'speech-configured', 'speech-prepare': 'speech-preparing', 'speech-cancel-preparation': 'speech-preparation-cancelled', 'speech-transcribe': 'speech-transcript', 'speech-cancel': 'speech-cancelled', 'speech-subscribe': 'speech-subscribed', 'speech-unsubscribe': 'speech-unsubscribed' }[type] || type;
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

  /** 卸载插件；响应帧 kind=plugin-uninstall-result（或 error）。 */
  requestPluginUninstall(name) {
    return this.requestPlugin('plugin-uninstall', { name: name }, 60000);
  }

  /** 插件目录；响应帧 kind=plugin-catalog（bundles/plugins/officialItems）。 */
  sendPluginCatalog(requestId) {
    return this.send({ type: 'plugin-catalog', requestId: requestId });
  }

  /** 读取费用/成本概览（仅 summary 动作，无需登录网关）。 */
  async requestCostMeter(action = 'summary', payload = {}) {
    // this.state 是字符串（'disconnected' | 'connecting' | 'connected' | 'failed'），
    // 不是 store 的连接状态对象；误写成 this.state.connection 会永远读出 undefined，
    // 导致每次请求都抛「未连接」，额度卡片/额度页一直显示数据不可用。
    if (this.state !== 'connected') throw new Error(uiText('未连接'));
    const request = Object.assign({}, payload || {}, { type: 'cost-meter', requestId: util.uuid(), action });
    return await this.requestPlugin('cost-meter', request, 20000);
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
