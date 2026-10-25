'use strict';
// 单进程授权服务。微信 AppSecret 与管理员 OpenID 仅保留在服务端。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createConsole } = require('./console.cjs');
const { createEngagement } = require('./engagement.cjs');
const { createAnnouncements } = require('./announcements.cjs');
const { DEFAULT_TEMPLATE_ID, createWechatNotificationSender } = require('./notifications.cjs');
const DAY = 86400000;
// 兑换码可选档位：签发时代入 days/uses，兑换时按 days 累加到公网到期时间。
// 1 天=体验/补偿，90=季度，730=2 年，1095=3 年，3650=长期（近似永久，避开真·永久的判定分支）。
// 客户端（小程序设置页/兑换码管理）的档位顺序必须与这两个数组一致。
const CODE_DAYS = [1, 3, 7, 30, 60, 90, 180, 365, 730, 1095, 3650];
const CODE_USES = [1, 5, 20, 50, 100];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const nodeIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function createService({ stateFile, adminOpenIds = [], managedNodeIds = [], exchangeCode, grantAccess, consoleOptions, relayAuthSecret = '', now = Date.now,
  notificationTemplateId = DEFAULT_TEMPLATE_ID, sendNotification }) {
  if (!stateFile || !Array.isArray(adminOpenIds) || !Array.isArray(managedNodeIds) || (!consoleOptions && (!adminOpenIds.length || typeof exchangeCode !== 'function'))) throw new Error('Missing server configuration');
  if (relayAuthSecret && !/^[A-Za-z0-9_-]{32,128}$/.test(relayAuthSecret)) throw new Error('Invalid relay authorization secret');
  const admins = new Set(adminOpenIds), nodes = new Set(managedNodeIds.map(id => id.toLowerCase()));
  if ([...nodes].some(id => !nodeIdPattern.test(id))) throw new Error('Invalid managed node ID');
  let state = { version: 2, codes: {}, redemptions: {}, access: {}, notificationTickets: {} };
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (![1, 2].includes(state.version) || !state.codes || !state.redemptions) throw new Error('Unsupported state');
    if (state.version === 1 && state.access === undefined) state.access = {};
    if (!state.access || typeof state.access !== 'object' || Array.isArray(state.access) || Object.values(state.access).some(r => !r || !Number.isSafeInteger(r.expiresAt) || r.expiresAt < 0)) throw new Error('Invalid access state');
    if (state.notificationTickets === undefined) state.notificationTickets = {};
    if (!state.notificationTickets || typeof state.notificationTickets !== 'object' || Array.isArray(state.notificationTickets) ||
      Object.entries(state.notificationTickets).some(([key, item]) => !/^[a-f0-9]{64}$/.test(key) || !item || !/^[a-f0-9]{64}$/.test(item.openidHash || '') ||
        !['issued', 'sending', 'sent', 'failed'].includes(item.status) || !Number.isSafeInteger(item.expiresAt) || item.expiresAt < 0 ||
        !Number.isSafeInteger(item.createdAt) || item.createdAt < 0 || item.sessionId != null && (typeof item.sessionId !== 'string' || item.sessionId.length > 256) ||
        item.templateId != null && (typeof item.templateId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(item.templateId)))) throw new Error('Invalid notification state');
    // A process may stop after persisting "sending" but before recording the result.
    // Let the gateway's idempotent retry resume the notification after restart.
    for (const item of Object.values(state.notificationTickets)) if (item.status === 'sending') item.status = 'issued';
    if (state.version === 1) state.version = 2;
  } catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot read authorization state; refusing to reset it'); }
  const sessions = new Map(), limits = new Map(), inFlight = new Set(), notificationSends = new Map();
  // 公网租赁持久化：以前只存在内存里，进程一重启所有 lease 立刻失效，而小程序会把旧
  // token 缓存到过期（最长 1 天），表现为「服务端升级后部分手机公网连不上、没缓存的
  // 手机又能连」。单独存一个文件，读写失败只记日志，绝不影响连接本身。
  const leaseFile = path.join(path.dirname(stateFile), 'leases.json');
  const leases = new Map();
  try {
    const savedLeases = JSON.parse(fs.readFileSync(leaseFile, 'utf8')) || {};
    for (const [key, item] of Object.entries(savedLeases)) {
      if (!/^[a-f0-9]{64}$/.test(key) || !item || typeof item.openid !== 'string' || typeof item.nodeId !== 'string' ||
        typeof item.deviceId !== 'string' || !Number.isSafeInteger(item.expiresAt) || item.expiresAt <= now()) continue;
      leases.set(key, { openid: item.openid, nodeId: item.nodeId, deviceId: item.deviceId, expiresAt: item.expiresAt });
    }
  } catch (e) {
    // 租赁是短期凭据：文件损坏时从空开始，不能因此拒绝启动（用户的公网时长在 state.json 里）。
    if (e.code !== 'ENOENT') console.warn('[access] ignoring unreadable public lease file:', e.message);
  }
  function persistLeases() {
    try {
      for (const [key, item] of leases) if (item.expiresAt <= now()) leases.delete(key);
      const payload = {};
      for (const [key, item] of leases) payload[key] = item;
      fs.mkdirSync(path.dirname(leaseFile), { recursive: true, mode: 0o700 });
      const temp = leaseFile + '.' + crypto.randomUUID() + '.tmp';
      try {
        fs.writeFileSync(temp, JSON.stringify(payload), { mode: 0o600, flag: 'wx' });
        const fd = fs.openSync(temp, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(temp, leaseFile);
      } finally { try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
    } catch (e) {
      // 持久化只是保险，写不进去也要让这次连接正常工作。
      console.warn('[access] cannot persist public leases:', e.message);
    }
  }
  function commit(change) {
    const next = JSON.parse(JSON.stringify(state));
    const result = change(next);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    const temp = stateFile + '.' + crypto.randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      const fd = fs.openSync(temp, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, stateFile);
      state = next;
    } finally { try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
    return result;
  }
  function limit(key, count) {
    const time = now();
    for (const [k, v] of limits) if (v.until <= time) limits.delete(k);
    const item = limits.get(key) || { used: 0, until: time + 60000 };
    if (item.used >= count || limits.size > 10000) throw fail(429, 'RATE_LIMITED', '操作过于频繁，请稍后重试');
    item.used++; limits.set(key, item);
  }
  function isAdmin(openid) { return admins.has(openid) || !!consoleApp?.adminIds().includes(openid); }
  function activeGrant() { const config = consoleApp?.grant(); return config?.url ? grantAdapter(config.url, config.token) : grantAccess; }
  function account(openid) {
    const accountId = hash(openid);
    const publicAccessExpiresAt = Number(state.access[accountId]?.expiresAt) || 0;
    const admin = isAdmin(openid);
    return {
      isAdmin: admin,
      // Global account grants are handled by this service. The adapter remains
      // available for legacy node-bound grants and external deployments.
      grantReady: typeof activeGrant() === 'function',
      publicAccessReady: true,
      publicAccess: admin || publicAccessExpiresAt > now(),
      publicAccessExpiresAt: admin ? 0 : publicAccessExpiresAt || null,
      deviceId: engagement.identify(openid).deviceId
    };
  }
  function auth(req) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
    const saved = match && sessions.get(hash(match[1]));
    if (!saved || saved.expiresAt <= now()) throw fail(401, 'UNAUTHORIZED', '微信登录已过期，请重新验证');
    return saved;
  }
  function requireAdmin(user) { if (!user.consoleAdmin && !isAdmin(user.openid)) throw fail(403, 'FORBIDDEN', '当前微信没有管理员权限'); }
  function requireGrant() { if (typeof activeGrant() !== 'function') throw fail(503, 'GRANT_NOT_CONFIGURED', '公网授权服务尚未接入，暂不能生成或兑换'); }
  function validNode(value) {
    const id = typeof value === 'string' ? value.toLowerCase() : '';
    if (!nodeIdPattern.test(id) || (!nodes.has(id) && !consoleApp?.nodeIds().includes(id))) throw fail(400, 'INVALID_NODE', '该节点尚未接入公网授权服务');
    return id;
  }
  function publicCode(record) {
    const { id, nodeId, days, uses, used, createdAt, expiresAt, revokedAt } = record;
    return { id, nodeId, days, uses, used, createdAt, expiresAt, revokedAt, canCopy: !!record.sealedCode };
  }
  async function body(req) {
    let size = 0, chunks = [];
    const timer = setTimeout(() => req.destroy(), 10000); timer.unref();
    try {
      for await (const chunk of req) {
        size += chunk.length;
        const proofRoute = /^\/share\/moments\/(start|submit)$/.test(new URL(req.url, 'http://localhost').pathname);
        if (size > (proofRoute ? 470000 : 16384)) throw fail(413, 'TOO_LARGE', '请求内容过长');
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { throw fail(400, 'BAD_JSON', '请求格式无效'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail(400, 'BAD_JSON', '请求格式无效');
      return data;
    } finally { clearTimeout(timer); }
  }
  function respond(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  }
  const engagement = createEngagement({ getState: () => state, commit, now, limit });
  const announcements = createAnnouncements({ getState: () => state, commit, now });
  const consoleApp = createConsole({ options: consoleOptions, getState: () => state, commit, body, respond, now, limit, engagement,
    envAdmins: [...admins], invalidateSessions: () => { sessions.clear(); leases.clear(); persistLeases(); }, hasPendingGrants: () => Object.values(state.redemptions).some(r => r.status === 'pending') });
  const deliverNotification = sendNotification || createWechatNotificationSender({
    getWechatConfig: async () => consoleApp?.wechat(), templateId: notificationTemplateId, now,
  });
  function cleanupNotificationTickets() {
    const expired = Object.entries(state.notificationTickets).filter(([, item]) => item.expiresAt <= now()).map(([key]) => key);
    if (expired.length) commit(next => { for (const key of expired) delete next.notificationTickets[key]; });
  }
  cleanupNotificationTickets();
  engagement.cleanup();
  const proofCleanup = setInterval(() => {
    try { engagement.cleanup(); cleanupNotificationTickets(); }
    catch { console.error('Public service cleanup failed; check state storage'); }
  }, 60000);
  proofCleanup.unref();
  const server = http.createServer(async (req, res) => {
    try {
      let route = new URL(req.url, 'http://localhost').pathname;
      // Private relay-to-console check; never trust client-supplied expiry/role.
      if (req.method === 'POST' && route === '/internal/relay/authorize') {
        const supplied = String(req.headers.authorization || '').replace(/^Bearer /, '');
        if (!relayAuthSecret || !crypto.timingSafeEqual(Buffer.from(hash(supplied)), Buffer.from(hash(relayAuthSecret)))) throw fail(403, 'FORBIDDEN', '中继认证失败');
        const input = await body(req);
        const lease = typeof input.token === 'string' && leases.get(hash(input.token));
        if (!lease || lease.nodeId !== input.nodeId || lease.deviceId !== input.deviceId || lease.expiresAt <= now()) throw fail(401, 'LEASE_EXPIRED', '公网连接凭据已失效');
        const current = account(lease.openid);
        if (!current.publicAccess) throw fail(403, 'PUBLIC_ACCESS_REQUIRED', '公网服务已到期，请兑换续期；局域网连接不受影响');
        respond(res, 200, { allowed: true, accountId: hash(lease.openid), expiresAt: Math.min(lease.expiresAt, current.publicAccessExpiresAt || Infinity) }); return;
      }
      // Authenticated connectors have their own per-node limit; shared reverse proxies
      // must not make a few nodes exhaust the browser/WeChat request bucket.
      if (!route.startsWith('/connector/')) limit('ip:' + req.socket.remoteAddress, 120);
      if (req.method === 'GET' && route === '/health') { respond(res, 200, { ok: true }); return; }
      // Public product information must not require a subscription, device, or WeChat login.
      if (req.method === 'GET' && route === '/app-content') { respond(res, 200, { ...announcements.list(), shareEnabled: engagement.rules().enabled }); return; }
      const handled = consoleApp && await consoleApp.handle(req, res, route);
      if (handled === true) return;
      if (handled) route = handled.route;
      if (req.method === 'POST' && route === '/session') {
        limit('login:' + req.socket.remoteAddress, 20);
        const input = await body(req);
        if (typeof input.code !== 'string' || input.code.length < 1 || input.code.length > 512) throw fail(400, 'INVALID_LOGIN_CODE', '缺少微信登录凭证');
        // 不接受客户端传入的角色、OpenID 或管理员标记。
        const config = consoleApp?.wechat();
        const exchange = config?.appId && config?.appSecret ? exchangeWithWechat(config.appId, config.appSecret) : exchangeCode;
        if (typeof exchange !== 'function') throw fail(503, 'WECHAT_NOT_CONFIGURED', '请先在网页管理后台配置小程序 AppID 与 AppSecret');
        const openid = await exchange(input.code);
        if (typeof openid !== 'string' || !openid || openid.length > 128) throw fail(401, 'LOGIN_FAILED', '微信身份验证失败');
        for (const [key, item] of sessions) if (item.expiresAt <= now()) sessions.delete(key);
        if (sessions.size >= 10000) throw fail(503, 'BUSY', '登录服务繁忙，请稍后重试');
        const token = crypto.randomBytes(32).toString('base64url'), expiresAt = now() + 2 * 60 * 60000;
        sessions.set(hash(token), { openid, expiresAt });
        respond(res, 201, { token, expiresAt, account: account(openid) }); return;
      }
      if (req.method === 'POST' && route === '/notifications/complete') {
        const input = await body(req);
        const ticket = typeof input.ticket === 'string' ? input.ticket : '';
        const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
        if (!/^[A-Za-z0-9_-]{43}$/.test(ticket) || !sessionId || sessionId.length > 256 || input.status !== 'completed') throw fail(400, 'INVALID_NOTIFICATION', '任务通知凭据无效');
        // 可选指标：网关在回合结束后提交，用于填充自定义模板字段。
        const taskName = typeof input.taskName === 'string' ? input.taskName.slice(0, 200) : undefined;
        const durationMs = input.durationMs != null && Number.isFinite(Number(input.durationMs)) && Number(input.durationMs) >= 0 ? Number(input.durationMs) : undefined;
        const tokens = input.tokens != null && Number.isFinite(Number(input.tokens)) && Number(input.tokens) >= 0 ? Number(input.tokens) : undefined;
        const cacheHitRate = input.cacheHitRate != null && Number.isFinite(Number(input.cacheHitRate)) && Number(input.cacheHitRate) >= 0 && Number(input.cacheHitRate) <= 1 ? Number(input.cacheHitRate) : undefined;
        const metrics = {};
        if (taskName !== undefined) metrics.taskName = taskName;
        if (durationMs !== undefined) metrics.durationMs = durationMs;
        if (tokens !== undefined) metrics.tokens = tokens;
        if (cacheHitRate !== undefined) metrics.cacheHitRate = cacheHitRate;
        const key = hash(ticket), entry = state.notificationTickets[key];
        if (!entry || entry.expiresAt <= now()) {
          if (entry) commit(next => { delete next.notificationTickets[key]; });
          throw fail(404, 'NOTIFICATION_EXPIRED', '任务通知凭据已失效');
        }
        if (entry.sessionId && entry.sessionId !== sessionId) throw fail(409, 'NOTIFICATION_SESSION_MISMATCH', '任务通知凭据已用于其他会话');
        if (entry.status === 'sent') { respond(res, 200, { sent: true, duplicate: true }); return; }
        if (entry.status === 'failed') throw fail(409, 'NOTIFICATION_UNAVAILABLE', '任务通知无法发送');
        let sending = notificationSends.get(key);
        if (!sending) {
          commit(next => { next.notificationTickets[key].status = 'sending'; next.notificationTickets[key].sessionId = sessionId; });
          const openid = state.engagement?.identities?.[entry.openidHash]?.openid;
          if (!openid) {
            commit(next => { next.notificationTickets[key].status = 'failed'; });
            throw fail(409, 'NOTIFICATION_UNAVAILABLE', '任务通知身份已失效');
          }
          const notificationContext = { sessionId };
          if (entry.templateId) notificationContext.templateId = entry.templateId;
          sending = Promise.resolve().then(() => deliverNotification(openid, { ...notificationContext, ...metrics }))
            .then(() => commit(next => { next.notificationTickets[key].status = 'sent'; next.notificationTickets[key].sentAt = now(); }))
            .catch(error => {
              // 记录微信返回的具体错误码（WECHAT_API_xxx / TEMPLATE_NOT_FOUND 等），否则「收不到通知」无从排查。
              console.error('Task completion notification failed:', error && error.code || 'UNKNOWN', error && error.message || '');
              commit(next => { next.notificationTickets[key].status = error && error.retryable ? 'issued' : 'failed'; });
              throw error;
            }).finally(() => notificationSends.delete(key));
          notificationSends.set(key, sending);
        }
        await sending;
        respond(res, 200, { sent: true }); return;
      }
      const user = handled?.user || auth(req);
      if (req.method === 'GET' && route === '/me') { respond(res, 200, { account: account(user.openid) }); return; }
      if (req.method === 'POST' && route === '/notifications/tickets') {
        const input = await body(req);
        limit('notification-ticket:' + user.openid, 20);
        // 模板 ID 由小程序传入（唯一来源），服务端只校验格式并随票据保存。
        const templateId = typeof input.templateId === 'string' ? input.templateId : '';
        if (templateId && !/^[A-Za-z0-9_-]{43}$/.test(templateId)) throw fail(400, 'INVALID_TEMPLATE_ID', '通知模板 ID 无效');
        if (typeof sendNotification !== 'function') {
          const config = consoleApp?.wechat();
          if (!config?.appId || !config?.appSecret) throw fail(503, 'WECHAT_NOT_CONFIGURED', '微信订阅通知尚未配置，请联系管理员');
        }
        const time = now();
        const activeTickets = Object.values(state.notificationTickets).filter(item => item.expiresAt > time).length;
        if (activeTickets >= 10000) throw fail(503, 'BUSY', '通知服务繁忙，请稍后重试');
        const ticket = crypto.randomBytes(32).toString('base64url');
        const expiresAt = time + 3 * DAY;
        const openidHash = hash(user.openid);
        commit(next => {
          for (const [key, item] of Object.entries(next.notificationTickets)) if (item.expiresAt <= time) delete next.notificationTickets[key];
          next.notificationTickets[hash(ticket)] = { openidHash, status: 'issued', createdAt: time, expiresAt, ...(templateId ? { templateId } : {}) };
        });
        respond(res, 201, { ticket, expiresAt }); return;
      }
      if (req.method === 'GET' && route === '/share') { respond(res, 200, engagement.summary(user.openid)); return; }
      if (req.method === 'POST' && route === '/share/invite') { await body(req); limit('invite:'+user.openid,10); respond(res, 200, engagement.invitation(user.openid)); return; }
      if (req.method === 'POST' && route === '/share/open') { const input=await body(req); respond(res, 200, engagement.open(user.openid,input.token)); return; }
      if (req.method === 'POST' && route === '/share/moments/start') { const input=await body(req); respond(res, 200, engagement.momentsStart(user.openid,input)); return; }
      if (req.method === 'POST' && route === '/share/moments/submit') { const input=await body(req); respond(res, 200, engagement.momentsSubmit(user.openid,input)); return; }
      if (req.method === 'POST' && route === '/public-access/lease') {
        if (!relayAuthSecret) throw fail(503, 'RELAY_NOT_CONFIGURED', '请运行公网服务升级脚本，接通中继鉴权');
        limit('lease:' + user.openid, 60);
        const input = await body(req), current = account(user.openid);
        if (!current.publicAccess) throw fail(403, 'PUBLIC_ACCESS_REQUIRED', '请在设置→公网访问兑换开通；局域网连接不受影响');
        if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.nodeId || '') || !/^[A-Za-z0-9_-]{8,128}$/.test(input.deviceId || '')) throw fail(400, 'INVALID_DEVICE', '节点或设备标识无效');
        for (const [key, item] of leases) if (item.expiresAt <= now()) leases.delete(key);
        if (leases.size >= 20000) throw fail(503, 'BUSY', '连接服务繁忙，请稍后重试');
        const token = crypto.randomBytes(32).toString('base64url');
        const expiresAt = Math.min(now() + DAY, current.publicAccessExpiresAt || Infinity);
        leases.set(hash(token), { openid: user.openid, nodeId: input.nodeId, deviceId: input.deviceId, expiresAt });
        persistLeases();
        respond(res, 201, { token, expiresAt }); return;
      }
      if (req.method === 'POST' && route === '/admin-binding/claim' && consoleApp) {
        limit('binding:' + user.openid, 5);
        const input = await body(req);
        respond(res, 200, consoleApp.claim(user, input.code)); return;
      }
      if (route.startsWith('/admin/')) requireAdmin(user);
      if (req.method === 'GET' && route === '/admin/announcements') { respond(res, 200, announcements.list()); return; }
      if (req.method === 'POST' && route === '/admin/announcements') {
        const input = await body(req); requireAdmin(user); limit('announcement:' + user.openid, 30);
        respond(res, input.id ? 200 : 201, announcements.save(input)); return;
      }
      const announcementDelete = /^[/]admin[/]announcements[/]([a-f0-9-]{36})[/]delete$/.exec(route);
      if (req.method === 'POST' && announcementDelete) {
        const input = await body(req); requireAdmin(user); respond(res, 200, announcements.remove(announcementDelete[1], input.revision)); return;
      }
      if (req.method === 'POST' && route === '/admin/share/enabled') {
        const input = await body(req); requireAdmin(user);
        if (typeof input.enabled !== 'boolean') throw fail(400, 'INVALID_RULES', '分享开关无效');
        respond(res, 200, { shareEnabled: engagement.saveRules({ ...engagement.rules(), enabled: input.enabled }).enabled }); return;
      }
      if (consoleApp && req.method === 'GET' && route === '/admin/pairings') { respond(res, 200, consoleApp.pairingState()); return; }
      if (consoleApp && req.method === 'POST' && route === '/admin/pairings') {
        const input = await body(req);
        // Recheck after the request body is received; never trust cached client roles.
        requireAdmin(user);
        const result = await consoleApp.issuePairing(input, user);
        try { requireAdmin(user); } catch (error) { consoleApp.revokePairing(result.id); throw error; }
        respond(res, 201, result); return;
      }
      const revokePairing = /^\/admin\/pairings\/([a-f0-9-]{36})\/revoke$/.exec(route);
      if (consoleApp && req.method === 'POST' && revokePairing) { await body(req); requireAdmin(user); respond(res, 200, consoleApp.revokePairing(revokePairing[1])); return; }
      if (req.method === 'GET' && route === '/admin/codes') {
        respond(res, 200, { items: Object.values(state.codes).filter(r=>!r.deletedAt).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map(publicCode) }); return;
      }
      if (req.method === 'POST' && route === '/admin/codes') {
        limit('create:' + user.openid, 10);
        const input = await body(req);
        requireAdmin(user);
        // nodeId is optional for account-wide public access codes. Supplying it
        // keeps the older relay-grant contract working unchanged.
        const nodeId = input.nodeId ? validNode(input.nodeId) : null;
        // 节点码与账号码共用一份档位表（历史节点码多一档 90 天，现已并入）。
        if (!CODE_DAYS.includes(input.days) || !CODE_USES.includes(input.uses)) throw fail(400, 'INVALID_CODE_OPTIONS', '访问时长或次数无效');
        if (nodeId) requireGrant();
        const value = crypto.randomBytes(12).toString('hex').toUpperCase();
        const code = value.match(/.{1,6}/g).join('-');
        const record = { id: crypto.randomUUID(), nodeId, days: input.days, uses: input.uses,
          used: 0, createdAt: now(), expiresAt: now() + 30 * DAY, revokedAt: null };
        if (consoleApp) record.sealedCode = consoleApp.seal('redeem-code:' + record.id + ':' + code);
        commit(next => { next.codes[hash(value)] = record; });
        respond(res, 201, { code, ...publicCode(record) }); return;
      }
      const revoke = /^\/admin\/codes\/([a-f0-9-]{36})\/revoke$/.exec(route);
      const codeAction = /^\/admin\/codes\/([a-f0-9-]{36})\/(copy|delete)$/.exec(route);
      if (req.method === 'POST' && codeAction) {
        await body(req); requireAdmin(user); limit('code-action:'+user.openid,30);
        const entry=Object.entries(state.codes).find(([,r])=>r.id===codeAction[1]);
        if(!entry||entry[1].deletedAt)throw fail(404,'NOT_FOUND','兑换码不存在');
        if(codeAction[2]==='copy'){
          if(!entry[1].sealedCode||!consoleApp)throw fail(409,'LEGACY_CODE_UNRECOVERABLE','旧兑换码只存哈希，无法还原；请生成新码');
          const value=consoleApp.unseal(entry[1].sealedCode),prefix='redeem-code:'+entry[1].id+':';
          if(!value.startsWith(prefix))throw fail(503,'INVALID_CIPHERTEXT','兑换码密文校验失败');
          respond(res,200,{code:value.slice(prefix.length)});return;
        }
        if(Object.values(state.redemptions).some(r=>r.status==='pending'&&r.id&&r.nodeId===entry[1].nodeId))throw fail(409,'PENDING_REDEMPTION','存在待确认的旧版授权，请处理完成后删除');
        commit(next=>{const r=next.codes[entry[0]];r.deletedAt=now();r.revokedAt ||= now();delete r.sealedCode;});
        respond(res,200,{ok:true});return;
      }
      if (req.method === 'POST' && revoke) {
        await body(req);
        requireAdmin(user);
        const entry = Object.entries(state.codes).find(([, item]) => item.id === revoke[1]);
        if (!entry) throw fail(404, 'NOT_FOUND', '兑换码不存在');
        commit(next => { next.codes[entry[0]].revokedAt = now(); });
        respond(res, 200, { ok: true }); return;
      }
      if (req.method === 'POST' && route === '/redemptions') {
        limit('redeem:' + user.openid, 10);
        const input = await body(req);
        const code = typeof input.code === 'string' ? input.code.replace(/[\s-]/g, '').toUpperCase() : '';
        if (!/^[0-9A-F]{24}$/.test(code)) throw fail(400, 'INVALID_CODE', '兑换码格式无效');
        const codeHash = hash(code), record = state.codes[codeHash];
        const accountId = hash(user.openid), key = hash(accountId + ':' + codeHash);
        let redemption = state.redemptions[key];
        if (!record) throw fail(400, 'INVALID_CODE', '兑换码无效');
        // Scope comes from the stored code, not from a caller-controlled nodeId.
        const nodeId = record.nodeId || null;
        if (nodeId && nodeId !== validNode(input.nodeId)) throw fail(400, 'INVALID_CODE', '兑换码不适用于当前节点');
        if (redemption?.status === 'complete') { respond(res, 200, { expiresAt: redemption.expiresAt, alreadyRedeemed: true }); return; }
        if (nodeId) requireGrant();
        if (!nodeId) {
          if (record.revokedAt || record.expiresAt <= now() || record.used >= record.uses) throw fail(400, 'CODE_UNAVAILABLE', '兑换码已停用、已过期或次数已用完');
          const currentTime = now();
          const previousExpiry = Number(state.access[accountId]?.expiresAt) || 0;
          const expiresAt = (previousExpiry > currentTime ? previousExpiry : currentTime) + record.days * DAY;
          if (!Number.isSafeInteger(expiresAt)) throw fail(400, 'INVALID_EXPIRY', '累计有效期过长');
          // One durable transaction: no partial use debit or duplicate extension.
          commit(next => {
            next.codes[codeHash].used++;
            next.access[accountId] = { expiresAt, updatedAt: now() };
            next.redemptions[key] = { id: crypto.randomUUID(), accountId, nodeId: null, days: record.days, status: 'complete', createdAt: now(), expiresAt };
          });
          respond(res, 200, { expiresAt, alreadyRedeemed: false }); return;
        }
        if (!redemption) {
          if (record.revokedAt || record.expiresAt <= now() || record.used >= record.uses) throw fail(400, 'CODE_UNAVAILABLE', '兑换码已停用、已过期或次数已用完');
          if (Object.values(state.redemptions).some(r => r.accountId === accountId && r.nodeId === nodeId && r.status === 'pending')) throw fail(409, 'PENDING_REDEMPTION', '上次兑换正在处理中，请先重试上次的兑换码');
          redemption = { id: crypto.randomUUID(), accountId, nodeId, days: record.days, status: 'pending', createdAt: now() };
          // 先持久化占用，超时后同码重试沿用幂等 ID，不能盲目释放次数。
          commit(next => { next.codes[codeHash].used++; next.redemptions[key] = redemption; });
        }
        if (inFlight.has(key)) throw fail(409, 'PENDING_REDEMPTION', '兑换正在处理，请稍后重试');
        inFlight.add(key);
        try {
          const grant = await activeGrant()({ redemptionId: redemption.id, accountId, nodeId, durationMs: redemption.days * DAY });
          if (!grant || grant.applied !== true || grant.redemptionId !== redemption.id || grant.accountId !== accountId || grant.nodeId !== nodeId || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= now()) throw fail(503, 'GRANT_PENDING', '授权尚未确认，请稍后使用同一码重试，不会重复扣减次数');
          commit(next => { Object.assign(next.redemptions[key], { status: 'complete', expiresAt: grant.expiresAt }); });
          respond(res, 200, { expiresAt: grant.expiresAt, alreadyRedeemed: false }); return;
        } finally { inFlight.delete(key); }
      }
      throw fail(404, 'NOT_FOUND', '接口不存在');
    } catch (e) {
      if (!res.headersSent) respond(res, e.status || 503, { code: e.code && e.status ? e.code : 'SERVICE_UNAVAILABLE', message: e.status ? e.message : '服务暂不可用，请稍后重试' });
      else res.end();
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 12000;
  server.on('close', () => { clearInterval(proofCleanup); consoleApp?.close(); });
  return server;
}
function exchangeWithWechat(appId, appSecret) {
  return async code => {
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search = new URLSearchParams({ appid: appId, secret: appSecret, js_code: code, grant_type: 'authorization_code' });
    // URL 含 AppSecret，不可记录到日志。
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    const result = await response.json();
    if (!response.ok || result.errcode || !result.openid) throw fail(401, 'LOGIN_FAILED', '微信身份验证失败，请重新登录');
    return result.openid;
  };
}
function grantAdapter(url, token) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !token) throw new Error('Grant service requires HTTPS and a server-side token');
  return async input => {
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'Idempotency-Key': input.redemptionId }, body: JSON.stringify(input) });
    if (!response.ok) throw fail(503, 'GRANT_PENDING', '公网授权服务暂不可用，请使用同一码重试');
    return response.json();
  };
}
if (require.main === module) {
  const env = process.env;
  if (!env.CONSOLE_ORIGIN) throw new Error('Set CONSOLE_ORIGIN to your HTTPS origin (or http://127.0.0.1:8790 for local development)');
  const server = createService({ stateFile: env.ACCESS_STATE_FILE || path.join(__dirname, 'data/state.json'),
    relayAuthSecret: env.RELAY_AUTH_SECRET || '',
    adminOpenIds: (env.ADMIN_OPENIDS || '').split(',').map(v => v.trim()).filter(Boolean),
    managedNodeIds: (env.MANAGED_NODE_IDS || '').split(',').map(v => v.trim()).filter(Boolean),
    consoleOptions: { origin: env.CONSOLE_ORIGIN, masterKey: env.ACCESS_MASTER_KEY, setupToken: env.CONSOLE_SETUP_TOKEN, legacyAppId: env.WECHAT_APP_ID },
    exchangeCode: env.WECHAT_APP_ID && env.WECHAT_APP_SECRET ? exchangeWithWechat(env.WECHAT_APP_ID, env.WECHAT_APP_SECRET) : undefined,
    grantAccess: env.ACCESS_GRANT_URL ? grantAdapter(env.ACCESS_GRANT_URL, env.ACCESS_GRANT_TOKEN) : null });
  server.listen(Number(env.ACCESS_PORT || 8790), env.ACCESS_HOST || '127.0.0.1', () => console.log('Public access service listening; secrets are not logged'));
}
module.exports = { createService, exchangeWithWechat, grantAdapter };
