'use strict';
// 单进程授权服务。微信 AppSecret 与管理员 OpenID 仅保留在服务端。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createConsole } = require('./console.cjs');
const { createEngagement } = require('./engagement.cjs');
const { createAnnouncements } = require('./announcements.cjs');
const DAY = 86400000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const nodeIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function createService({ stateFile, adminOpenIds = [], managedNodeIds = [], exchangeCode, grantAccess, consoleOptions, relayAuthSecret = '', now = Date.now }) {
  if (!stateFile || !Array.isArray(adminOpenIds) || !Array.isArray(managedNodeIds) || (!consoleOptions && (!adminOpenIds.length || typeof exchangeCode !== 'function'))) throw new Error('Missing server configuration');
  if (relayAuthSecret && !/^[A-Za-z0-9_-]{32,128}$/.test(relayAuthSecret)) throw new Error('Invalid relay authorization secret');
  const admins = new Set(adminOpenIds), nodes = new Set(managedNodeIds.map(id => id.toLowerCase()));
  if ([...nodes].some(id => !nodeIdPattern.test(id))) throw new Error('Invalid managed node ID');
  let state = { version: 2, codes: {}, redemptions: {}, access: {} };
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (![1, 2].includes(state.version) || !state.codes || !state.redemptions) throw new Error('Unsupported state');
    if (state.version === 1 && state.access === undefined) state.access = {};
    if (!state.access || typeof state.access !== 'object' || Array.isArray(state.access) || Object.values(state.access).some(r => !r || !Number.isSafeInteger(r.expiresAt) || r.expiresAt < 0)) throw new Error('Invalid access state');
    if (state.version === 1) state.version = 2;
  } catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot read authorization state; refusing to reset it'); }
  const sessions = new Map(), leases = new Map(), limits = new Map(), inFlight = new Set();
  function commit(change) {
    const next = JSON.parse(JSON.stringify(state));
    const result = change(next);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    const temp = stateFile + '.' + crypto.randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      const fd = fs.openSync(temp, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
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
    envAdmins: [...admins], invalidateSessions: () => { sessions.clear(); leases.clear(); }, hasPendingGrants: () => Object.values(state.redemptions).some(r => r.status === 'pending') });
  engagement.cleanup();
  const proofCleanup = setInterval(() => { try { engagement.cleanup(); } catch { console.error('Share evidence cleanup failed; check state storage'); } }, 60000);
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
      const user = handled?.user || auth(req);
      if (req.method === 'GET' && route === '/me') { respond(res, 200, { account: account(user.openid) }); return; }
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
        if (!(nodeId ? [3, 7, 30, 90, 180, 365] : [3, 7, 30, 180, 365]).includes(input.days) || ![1, 5, 20].includes(input.uses)) throw fail(400, 'INVALID_CODE_OPTIONS', '访问时长或次数无效');
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
          const expiresAt = Math.max(Number(state.access[accountId]?.expiresAt) || 0, now()) + record.days * DAY;
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
