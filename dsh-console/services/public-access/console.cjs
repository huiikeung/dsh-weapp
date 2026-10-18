'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DAY, DURATIONS, validDays } = require('./durations.cjs');
const scrypt = promisify(crypto.scrypt);
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const openIdPattern = /^[A-Za-z0-9_-]{10,128}$/;
const constantEqual = (a, b) => crypto.timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));

function createConsole({ options, getState, commit, body, respond, now, limit, envAdmins, invalidateSessions, hasPendingGrants, engagement }) {
  if (!options) return null;
  const origin = new URL(options.origin);
  const local = origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if ((!local && origin.protocol !== 'https:') || origin.origin !== options.origin || origin.username || origin.password) throw new Error('CONSOLE_ORIGIN must be an HTTPS origin (HTTP loopback only for local tests)');
  if (!/^[0-9a-f]{64}$/i.test(options.masterKey || '')) throw new Error('ACCESS_MASTER_KEY must contain 64 hex characters');
  const masterKey = Buffer.from(options.masterKey, 'hex');
  const sessions = new Map(), seen = new Map(), jobs = new Map();
  const state = () => getState().console || { admins: [], bindings: {}, nodes: {}, settings: {} };
  function update(fn) { return commit(next => { next.console ||= { admins: [], bindings: {}, nodes: {}, settings: {} }; return fn(next.console); }); }
  if (Object.values(state().pairings || {}).some(r => r.status === 'issuing')) update(s => { for (const r of Object.values(s.pairings || {})) if (r.status === 'issuing') r.status = 'failed'; });
  if (!state().owner && (!options.setupToken || options.setupToken.length < 32)) throw new Error('Set a random CONSOLE_SETUP_TOKEN of at least 32 characters for initial setup');
  function seal(value) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data };
  }
  function unseal(value) {
    if (!value) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(value.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(value.tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(value.data, 'hex')), decipher.final()]).toString('utf8');
  }
  // Refuse to start with the wrong encryption key, instead of silently discarding credentials.
  unseal(state().settings.wechatSecret);
  unseal(state().settings.grantToken);
  for (const record of Object.values(getState().codes)) if (record.sealedCode) unseal(record.sealedCode);
  function cookie(value, expired = false) {
    return 'dsh_console=' + value + '; Path=/; HttpOnly; SameSite=Strict; ' + (local ? '' : 'Secure; ') + 'Max-Age=' + (expired ? 0 : 7200);
  }
  function browserAuth(req) {
    const raw = /(?:^|;\s*)dsh_console=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || '');
    const session = raw && sessions.get(hash(raw[1]));
    if (!session || session.expiresAt <= now()) throw failure(401, 'CONSOLE_LOGIN_REQUIRED', '请登录管理后台');
    if (req.method !== 'GET') {
      if (req.headers.origin !== options.origin || !constantEqual(req.headers['x-csrf-token'] || '', session.csrf)) throw failure(403, 'CSRF', '页面验证已失效，请刷新后重试');
    }
    return session;
  }
  function adminIds() { return state().admins.map(a => a.openid); }
  function nodeIds() { return Object.values(state().nodes).filter(n => !n.disabled && n.relayNodeId).map(n => n.relayNodeId); }
  function wechat() { const s = state().settings; return { appId: s.appId || '', appSecret: unseal(s.wechatSecret) }; }
  function grant() { const s = state().settings; return { url: s.grantUrl || '', token: unseal(s.grantToken) }; }
  function nodeView(n) {
    const live = seen.get(n.id);
    return { id: n.id, name: n.name, disabled: !!n.disabled, relayNodeId: n.relayNodeId || '',
      relay: n.relay || '', createdAt: n.createdAt, online: !n.disabled && !!live && live.at + 30000 > now(),
      lastSeenAt: live?.at || null, connectedDevices: live?.connectedDevices || 0,
      ready: !!live && live.at + 30000 > now() && live.ready && !n.disabled,
      managedPairingReady: !n.disabled && !!live && live.at + 30000 > now() && live.ready && live.managedPairingVersion === 1,
      message: live?.message || '等待电脑端连接器上线' };
  }
  function connectorAuth(req) {
    const raw = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
    const node = raw && Object.values(state().nodes).find(n => !n.disabled && constantEqual(n.tokenHash, hash(raw[1])));
    if (!node) { limit('bad-connector:' + req.socket.remoteAddress, 15); throw failure(401, 'CONNECTOR_UNAUTHORIZED', '连接器凭据无效'); }
    return node;
  }
  function rejectNodeJobs(id) {
    for (const job of jobs.values()) if (job.nodeId === id) job.finish(failure(409, 'NODE_CHANGED', '节点配置已变更，请重试'));
  }
  function createPair(node, policy) {
    if (!nodeView(node).ready) throw failure(409, 'NODE_OFFLINE', '电脑端连接器未就绪，请先检查 DSH 网关和中继连接');
    if ([...jobs.values()].some(j => j.nodeId === node.id)) throw failure(409, 'PAIR_BUSY', '此节点已有配对请求正在生成');
    return new Promise((resolve, reject) => {
      const id = policy?.id || crypto.randomUUID();
      const timer = setTimeout(() => finish(failure(504, 'CONNECTOR_TIMEOUT', '电脑端未及时响应，请确认连接器仍在线')), options.jobTimeoutMs || 20000);
      function finish(error, value) { clearTimeout(timer); jobs.delete(id); error ? reject(error) : resolve(value); }
      jobs.set(id, { id, nodeId: node.id, policy, dispatched: false, finish });
    });
  }
  function validatePair(raw, node, policy) {
    if (typeof raw !== 'string' || raw.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw failure(502, 'INVALID_PAIR', '网关返回的配对内容无效');
    let p; try { p = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { throw failure(502, 'INVALID_PAIR', '网关返回的配对内容无效'); }
    if (p.version !== 3 || p.mode !== 'relay' || p.nodeId !== node.relayNodeId || p.relay !== node.relay || p.agentPubKey !== node.agentPubKey ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(p.pairingCode || '') || !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= now() || p.expiresAt > now() + 3600000) {
      throw failure(502, 'INVALID_PAIR', '配对信息与当前公网节点不一致，请检查插件的中继模式');
    }
    // Only transport fields needed by the miniapp; never disclose the gateway's LAN endpoint.
    const payload = { version: 3, mode: 'relay', relay: p.relay, nodeId: p.nodeId, agentPubKey: p.agentPubKey,
      pairingCode: p.pairingCode, expiresAt: p.expiresAt, gatewayName: node.name };
    if (policy) {
      if (p.managedPairingId !== policy.id || p.accessDays !== policy.days || !Number.isSafeInteger(p.accessExpiresAt) || Math.abs(p.accessExpiresAt - (now() + policy.days * DAY)) > 60000) throw failure(502, 'ACCESS_POLICY_MISMATCH', '网关没有确认所选访问期限，请升级限时配对扩展并校准电脑时间');
      Object.assign(payload, { managedPairingId: policy.id, accessDays: policy.days, accessExpiresAt: p.accessExpiresAt });
    }
    return { qrPayload: Buffer.from(JSON.stringify(payload)).toString('base64url'), expiresAt: p.expiresAt, ...(policy ? { accessExpiresAt: p.accessExpiresAt } : {}) };
  }
  function pairings() {
    return Object.values(state().pairings || {}).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map(r => ({ ...r,
      status: r.status === 'active' && r.accessExpiresAt <= now() || r.status === 'pending' && r.expiresAt <= now() ? 'expired' : r.status }));
  }
  function pairingState() { return { nodes: Object.values(state().nodes).map(nodeView), durations: DURATIONS, items: pairings(), syncedAt: now() }; }
  async function issuePairing(input, actor) {
    const node = state().nodes[input.nodeId];
    if (!node || node.disabled) throw failure(404, 'NODE_NOT_FOUND', '节点不存在或已停用');
    if (!validDays(input.days)) throw failure(400, 'INVALID_DURATION', '请选择 3 天、7 天、30 天、半年或 1 年');
    if (!nodeView(node).managedPairingReady) throw failure(409, 'MANAGED_PAIRING_REQUIRED', '电脑端未就绪或未安装限时配对扩展；不能签发没有到期控制的配对码');
    limit('pair:' + node.id, 10);
    if (Object.keys(state().pairings || {}).length >= 10000) throw failure(409, 'HISTORY_FULL', '配对记录已达到上限，请先归档');
    const id = crypto.randomUUID(), policy = { id, days: input.days };
    const record = { id, nodeId: node.id, nodeName: node.name, relayNodeId: node.relayNodeId, days: input.days, createdAt: now(),
      source: actor.consoleAdmin ? 'web' : 'weapp', creatorId: hash(actor.openid), status: 'issuing', expiresAt: null, accessExpiresAt: null, deviceId: null };
    update(s => { s.pairings ||= {}; s.pairings[id] = record; });
    try {
      const result = await createPair(node, policy);
      update(s => { Object.assign(s.pairings[id], { status: 'pending', expiresAt: result.expiresAt, accessExpiresAt: result.accessExpiresAt }); });
      return { ...record, ...result, status: 'pending', qrImage: await require('qrcode').toDataURL(result.qrPayload, { errorCorrectionLevel: 'M', margin: 2, width: 360 }) };
    } catch (e) { update(s => { s.pairings[id].status = 'failed'; }); throw e; }
  }
  function revokePairing(id) {
    const record = state().pairings?.[id];
    if (!record) throw failure(404, 'NOT_FOUND', '配对记录不存在');
    if (['revoked', 'expired', 'failed', 'superseded'].includes(record.status)) return { ok: true, status: record.status };
    if (record.status === 'issuing') throw failure(409, 'PAIR_BUSY', '配对码仍在生成，请稍后重试');
    update(s => { s.pairings[id].status = 'revoking'; s.pairings[id].revokeRequestedAt = now(); });
    return { ok: true, status: 'revoking' };
  }
  function syncPairings(node, reports) {
    if (!Array.isArray(reports) || reports.length > 100) throw failure(400, 'INVALID_REPORT', '配对状态报告无效');
    const changes = [];
    for (const r of reports) {
      const prior = r && state().pairings?.[r.id];
      if (!prior || prior.nodeId !== node.id || prior.days !== r.days || prior.accessExpiresAt !== r.accessExpiresAt || prior.expiresAt !== r.expiresAt) continue;
      if (!['pending', 'active', 'expired', 'revoked', 'superseded'].includes(r.status) || r.deviceId && !uuid.test(r.deviceId) || r.status === 'active' && !uuid.test(r.deviceId || '')) continue;
      if (prior.status === 'revoking' && !['revoked', 'expired', 'superseded'].includes(r.status)) continue;
      if (prior.status === 'active' && r.status === 'pending') continue;
      if (prior.deviceId && prior.deviceId !== r.deviceId) continue;
      if (['revoked', 'expired', 'superseded', 'failed'].includes(prior.status)) continue;
      if (prior.status !== r.status || prior.deviceId !== (r.deviceId || null)) changes.push({ id: r.id, status: r.status, deviceId: r.deviceId || null });
    }
    if (changes.length) update(s => { for (const r of changes) Object.assign(s.pairings[r.id], r, { syncedAt: now() }); });
  }
  async function handle(req, res, route) {
    const files = { '/': ['index.html', 'text/html'], '/console': ['index.html', 'text/html'], '/console/': ['index.html', 'text/html'],
      '/console/app.js': ['app.js', 'text/javascript'], '/console/style.css': ['style.css', 'text/css'], '/console/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
    if (req.method === 'GET' && files[route]) {
      res.writeHead(200, { 'Content-Type': files[route][1] + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" });
      res.end(fs.readFileSync(path.join(__dirname, 'web', files[route][0]))); return true;
    }
    if (route.startsWith('/connector/')) {
      const node = connectorAuth(req);
      limit('connector:' + node.id, 90);
      if (req.method === 'POST' && route === '/connector/poll') {
        const data = await body(req), status = data.status || {}, relay = status.relay || {};
        const ready = status.gatewayEnabled === true && status.pairingMode === 'relay' && uuid.test(relay.nodeId || '') &&
          /^wss:\/\/[^/?#@\s]+(?:\/[^?#\s]*)?$/.test(relay.relay || '') && /^[A-Za-z0-9+/]{43}=$/.test(relay.agentPubKey || '');
        if (ready) {
          const changed = node.relayNodeId && (node.relayNodeId !== relay.nodeId || node.agentPubKey !== relay.agentPubKey || node.relay !== relay.relay);
          if (changed) throw failure(409, 'IDENTITY_CHANGED', '节点身份改变，请停用旧节点并重新添加');
          if (!node.relayNodeId) update(s => { Object.assign(s.nodes[node.id], { relayNodeId: relay.nodeId, relay: relay.relay, agentPubKey: relay.agentPubKey }); });
        }
        syncPairings(node, data.pairings || []);
        seen.set(node.id, { at: now(), ready, managedPairingVersion: status.managedPairingVersion, connectedDevices: Number.isSafeInteger(status.connectedClients) && status.connectedClients >= 0 ? status.connectedClients : 0,
          message: ready ? '网关已就绪，可以生成配对码' : '请在电脑端开启移动网关和中继模式' });
        const task = ready && [...jobs.values()].find(j => j.nodeId === node.id && !j.dispatched);
        if (task) task.dispatched = true;
        const revocations = Object.values(state().pairings || {}).filter(r => r.nodeId === node.id && r.status === 'revoking').slice(0, 10).map(r => r.id);
        respond(res, 200, { task: task ? { id: task.id, type: 'create-pairing', ...(task.policy ? { managedAccess: task.policy } : {}) } : null, revocations }); return true;
      }
      if (req.method === 'POST' && route === '/connector/result') {
        const data = await body(req), job = jobs.get(data.id);
        if (!job || job.nodeId !== node.id || !job.dispatched) throw failure(404, 'JOB_EXPIRED', '配对请求已过期');
        if (data.ok !== true) job.finish(failure(502, 'GATEWAY_PAIR_FAILED', '电脑端网关无法生成配对码，请查看连接器状态'));
        else {
          try { job.finish(null, validatePair(data.qrPayload, node, job.policy)); }
          catch (error) { job.finish(error); }
        }
        respond(res, 200, { ok: true }); return true;
      }
      throw failure(404, 'NOT_FOUND', '连接器接口不存在');
    }
    if (!route.startsWith('/console/api/')) return false;
    if (req.method === 'GET' && route === '/console/api/status') {
      let session; try { session = browserAuth(req); } catch {}
      respond(res, 200, { initialized: !!state().owner, authenticated: !!session, csrf: session?.csrf || '' }); return true;
    }
    if (req.method === 'POST' && ['/console/api/setup', '/console/api/login'].includes(route)) {
      if (req.headers.origin !== options.origin) throw failure(403, 'ORIGIN', '请从本站管理页面登录');
      limit('console-login:' + req.socket.remoteAddress, 8);
      const input = await body(req);
      if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) throw failure(400, 'PASSWORD_LENGTH', '密码长度需要 12–128 个字符');
      if (route.endsWith('/setup')) {
        if (state().owner) throw failure(409, 'ALREADY_SETUP', '管理后台已初始化');
        if (!constantEqual(input.setupToken || '', options.setupToken)) throw failure(403, 'SETUP_TOKEN', '初始化密钥不正确');
        const salt = crypto.randomBytes(16).toString('hex'), passwordHash = (await scrypt(input.password, salt, 64)).toString('hex');
        // Check again after asynchronous password hashing to prevent simultaneous bootstrap takeover.
        if (state().owner) throw failure(409, 'ALREADY_SETUP', '管理后台已初始化');
        update(s => { s.owner = { salt, passwordHash }; });
      } else {
        const owner = state().owner;
        if (!owner || !constantEqual((await scrypt(input.password, owner.salt, 64)).toString('hex'), owner.passwordHash) || state().owner.passwordHash !== owner.passwordHash) throw failure(401, 'BAD_LOGIN', '密码不正确或已经变更，请重新登录');
      }
      for (const [key, session] of sessions) if (session.expiresAt <= now()) sessions.delete(key);
      if (sessions.size >= 100) throw failure(429, 'TOO_MANY_SESSIONS', '管理会话过多，请稍后重试');
      const token = secret(), csrf = secret();
      sessions.set(hash(token), { csrf, expiresAt: now() + 7200000 });
      res.setHeader('Set-Cookie', cookie(token));
      respond(res, 200, { csrf }); return true;
    }
    browserAuth(req);
    if (/^[/]console[/]api[/]announcements(?:[/][a-f0-9-]{36}[/]delete)?$/.test(route) || route === '/console/api/share/enabled') {
      return { route: route.replace('/console/api/', '/admin/'), user: { consoleAdmin: true, openid: 'console-owner' } };
    }
    if (req.method === 'GET' && route === '/console/api/share') { respond(res,200,engagement.reviewList()); return true; }
    const proofMatch = /^[/]console[/]api[/]share[/]proof[/]([a-f0-9]{64})$/.exec(route);
    if (req.method === 'GET' && proofMatch) { respond(res,200,engagement.reviewProof(proofMatch[1])); return true; }
    if (req.method === 'POST' && route === '/console/api/share/rules') { respond(res,200,engagement.saveRules(await body(req))); return true; }
    if (req.method === 'POST' && route === '/console/api/share/review') { respond(res,200,engagement.review(await body(req))); return true; }
    if (req.method === 'POST' && route === '/console/api/admins/device') {
      const input=await body(req), identity=engagement.resolveDevice(String(input.deviceId||'').trim().toUpperCase());
      if(adminIds().length>=100)throw failure(400,'ADMIN_LIMIT','最多配置 100 位管理员');
      if(!adminIds().includes(identity.openid)&&!envAdmins.includes(identity.openid))update(s=>s.admins.push({openid:identity.openid,deviceId:identity.deviceId,label:String(input.label||'管理员').slice(0,60),createdAt:now()}));
      respond(res,200,{ok:true,deviceId:identity.deviceId});return true;
    }
    if (req.method === 'GET' && route === '/console/api/pairings') { respond(res, 200, pairingState()); return true; }
    if (req.method === 'POST' && route === '/console/api/pairings') { respond(res, 201, await issuePairing(await body(req), { consoleAdmin: true, openid: 'console-owner' })); return true; }
    const revokePair = /^\/console\/api\/pairings\/([a-f0-9-]{36})\/revoke$/.exec(route);
    if (req.method === 'POST' && revokePair) { await body(req); respond(res, 200, revokePairing(revokePair[1])); return true; }
    if (req.method === 'POST' && route === '/console/api/logout') {
      await body(req); const raw = /dsh_console=([^;]+)/.exec(req.headers.cookie || '');
      if (raw) sessions.delete(hash(raw[1]));
      res.setHeader('Set-Cookie', cookie('', true)); respond(res, 200, { ok: true }); return true;
    }
    if (req.method === 'GET' && route === '/console/api/overview') {
      const s = state();
      respond(res, 200, { origin: options.origin, settings: { appId: s.settings.appId || '', secretConfigured: !!s.settings.wechatSecret,
        grantUrl: s.settings.grantUrl || '', grantTokenConfigured: !!s.settings.grantToken },
        admins: [...envAdmins.map(openid => ({ openid, deviceId: engagement.deviceIdFor(openid), label: '环境变量管理员', source: 'environment' })), ...s.admins.map(a => ({ ...a, deviceId: engagement.deviceIdFor(a.openid), source: 'console' }))],
        bindings: Object.values(s.bindings).map(b => ({ id: b.id, label: b.label, expiresAt: b.expiresAt, openid: b.openid || '', status: b.status })),
        nodes: Object.values(s.nodes).map(nodeView) }); return true;
    }
    if (req.method === 'POST' && route === '/console/api/settings') {
      const input = await body(req);
      if (!/^wx[a-f0-9]{16}$/i.test(input.appId || '')) throw failure(400, 'INVALID_APPID', '请输入正确的小程序 AppID');
      const old = state().settings;
      const boundAppId = old.appId || options.legacyAppId;
      if (boundAppId && boundAppId !== input.appId) throw failure(409, 'APPID_LOCKED', '此服务已绑定小程序；更换 AppID 请部署独立数据目录，避免身份混用');
      if (input.appSecret && !/^[A-Za-z0-9]{32}$/.test(input.appSecret)) throw failure(400, 'INVALID_APPSECRET', 'AppSecret 格式不正确');
      if (!input.appSecret && !old.wechatSecret) throw failure(400, 'MISSING_APPSECRET', '首次配置需要填写 AppSecret');
      update(s => { s.settings.appId = input.appId; if (input.appSecret) s.settings.wechatSecret = seal(input.appSecret); });
      invalidateSessions(); respond(res, 200, { ok: true }); return true;
    }
    if (req.method === 'POST' && route === '/console/api/password') {
      limit('console-password', 8);
      const input = await body(req), owner = state().owner;
      if (typeof input.currentPassword !== 'string' || input.currentPassword.length > 128 || !constantEqual((await scrypt(input.currentPassword, owner.salt, 64)).toString('hex'), owner.passwordHash)) throw failure(403, 'BAD_LOGIN', '原密码不正确');
      if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) throw failure(400, 'PASSWORD_LENGTH', '新密码需要 12–128 个字符');
      const salt = crypto.randomBytes(16).toString('hex'), passwordHash = (await scrypt(input.password, salt, 64)).toString('hex');
      if (state().owner.passwordHash !== owner.passwordHash) throw failure(409, 'PASSWORD_CHANGED', '密码已在其他请求中更新，请重新登录');
      update(s => { s.owner = { salt, passwordHash }; }); sessions.clear();
      res.setHeader('Set-Cookie', cookie('', true)); respond(res, 200, { ok: true }); return true;
    }
    if (req.method === 'POST' && route === '/console/api/grant-settings') {
      const input = await body(req);
      if (hasPendingGrants()) throw failure(409, 'PENDING_GRANTS', '仍有待确认的兑换，请先处理完成再修改授权接口');
      let endpoint; try { endpoint = new URL(input.url); } catch { throw failure(400, 'INVALID_GRANT', '请输入实际授权服务的 HTTPS 地址'); }
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw failure(400, 'INVALID_GRANT', '授权接口必须使用不含账号、查询参数的 HTTPS 地址');
      if (input.token && (typeof input.token !== 'string' || input.token.length < 32 || input.token.length > 512 || /[\r\n]/.test(input.token))) throw failure(400, 'INVALID_GRANT_TOKEN', '管理密钥长度应为 32–512 字符');
      if (!input.token && (!state().settings.grantToken || state().settings.grantUrl !== endpoint.href)) throw failure(400, 'MISSING_GRANT_TOKEN', '首次配置或更换授权地址时必须填写管理密钥');
      update(s => { s.settings.grantUrl = endpoint.href; if (input.token) s.settings.grantToken = seal(input.token); });
      respond(res, 200, { ok: true }); return true;
    }
    if (req.method === 'POST' && route === '/console/api/admins') {
      const input = await body(req);
      if (!openIdPattern.test(input.openid || '')) throw failure(400, 'INVALID_OPENID', '请填写本小程序下的 OpenID，不是微信号或昵称');
      if (adminIds().length >= 100) throw failure(400, 'ADMIN_LIMIT', '最多配置 100 位管理员');
      if (!adminIds().includes(input.openid) && !envAdmins.includes(input.openid)) update(s => { s.admins.push({ openid: input.openid, label: String(input.label || '管理员').slice(0, 60), createdAt: now() }); });
      respond(res, 200, { ok: true }); return true;
    }
    if (req.method === 'POST' && route === '/console/api/admins/remove') {
      const input = await body(req);
      if (envAdmins.includes(input.openid)) throw failure(409, 'ENV_ADMIN', '此身份由环境变量配置，请在服务器修改');
      update(s => { s.admins = s.admins.filter(a => a.openid !== input.openid); });
      respond(res, 200, { ok: true }); return true;
    }
    if (req.method === 'POST' && route === '/console/api/bindings') {
      limit('console-bindings', 10);
      const input = await body(req), value = crypto.randomBytes(12).toString('hex').toUpperCase();
      const record = { id: crypto.randomUUID(), label: String(input.label || '管理员绑定').slice(0, 60), expiresAt: now() + 600000, status: 'pending' };
      update(s => { for (const [key, b] of Object.entries(s.bindings)) if (b.expiresAt <= now() || b.status === 'approved') delete s.bindings[key]; s.bindings[hash(value)] = record; });
      respond(res, 201, { code: 'WB-' + value.match(/.{1,6}/g).join('-'), ...record }); return true;
    }
    if (req.method === 'POST' && route === '/console/api/bindings/approve') {
      if (adminIds().length >= 100) throw failure(400, 'ADMIN_LIMIT', '最多配置 100 位管理员');
      const input = await body(req), entry = Object.entries(state().bindings).find(([, b]) => b.id === input.id);
      if (!entry || !entry[1].openid || entry[1].expiresAt <= now() || entry[1].status !== 'claimed') throw failure(409, 'BINDING_INVALID', '绑定申请尚未提交或已过期');
      update(s => { const b = s.bindings[entry[0]]; if (!s.admins.some(a => a.openid === b.openid) && !envAdmins.includes(b.openid)) s.admins.push({ openid: b.openid, label: b.label, createdAt: now() }); b.status = 'approved'; });
      respond(res, 200, { ok: true }); return true;
    }
    if (req.method === 'POST' && route === '/console/api/nodes') {
      const input = await body(req), name = String(input.name || '').trim();
      if (!name || name.length > 60 || Object.keys(state().nodes).length >= 100) throw failure(400, 'INVALID_NODE', '节点名称为 1–60 字，最多 100 个节点');
      const token = secret(), id = crypto.randomUUID();
      update(s => { s.nodes[id] = { id, name, createdAt: now(), tokenHash: hash(token), disabled: false }; });
      respond(res, 201, { id, token, server: options.origin }); return true;
    }
    const nodeAction = /^\/console\/api\/nodes\/([a-f0-9-]{36})\/(pair|disable|rotate)$/.exec(route);
    if (req.method === 'POST' && nodeAction) {
      await body(req);
      const node = state().nodes[nodeAction[1]];
      if (!node) throw failure(404, 'NOT_FOUND', '节点不存在');
      if (nodeAction[2] === 'pair') {
        limit('pair:' + node.id, 10);
        const result = await createPair(node);
        const QRCode = require('qrcode');
        respond(res, 201, { ...result, qrImage: await QRCode.toDataURL(result.qrPayload, { errorCorrectionLevel: 'M', margin: 2, width: 360 }) }); return true;
      }
      rejectNodeJobs(node.id); seen.delete(node.id);
      if (nodeAction[2] === 'disable') { update(s => { s.nodes[node.id].disabled = true; }); respond(res, 200, { ok: true }); }
      else { const token = secret(); update(s => { s.nodes[node.id].tokenHash = hash(token); s.nodes[node.id].disabled = false; }); respond(res, 200, { id: node.id, token, server: options.origin }); }
      return true;
    }
    // Reuse the existing redemption API, with a web-admin capability only created here after cookie+CSRF verification.
    if (/^\/console\/api\/codes(?:\/[a-f0-9-]{36}\/(?:revoke|copy|delete))?$/.test(route)) return { route: route.replace('/console/api/codes', '/admin/codes'), user: { consoleAdmin: true, openid: 'console-owner' } };
    throw failure(404, 'NOT_FOUND', '管理接口不存在');
  }
  function claim(user, code) {
    const value = typeof code === 'string' ? code.toUpperCase().replace(/^WB-/, '').replace(/-/g, '') : '';
    const key = hash(value), record = state().bindings[key];
    if (!/^[A-F0-9]{24}$/.test(value) || !record || record.expiresAt <= now() || record.status !== 'pending') throw failure(400, 'BINDING_INVALID', '绑定码已使用、已过期或不正确');
    update(s => { s.bindings[key].openid = user.openid; s.bindings[key].status = 'claimed'; });
    return { pendingApproval: true };
  }
  function close() { for (const job of jobs.values()) job.finish(failure(503, 'SHUTTING_DOWN', '服务正在关闭')); }
  return { handle, adminIds, nodeIds, wechat, grant, claim, close, pairingState, issuePairing, revokePairing, seal, unseal };
}
module.exports = { createConsole };
