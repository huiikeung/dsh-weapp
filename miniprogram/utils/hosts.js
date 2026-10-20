const { t: uiText } = require('./ui-preferences');
// 主机档案（GatewayProfile）与身份/地址校验：与 iOS
// DeepSeekHarnessMobile/Core/GatewayProfile.swift + MultiGatewayStore 对齐。
// 每条主机档案是持久化、凭据和缓存的共同命名空间：凭据按档案 ID 存储
// （dsh_creds.<id>），切换主机即切换整套连接凭据。

const util = require('./util');

const PROFILES_KEY = 'gateway.profiles.v1';
const ACTIVE_ID_KEY = 'gateway.activeID';
const CRED_PREFIX = 'dsh_creds.';

const IDENTITY_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

const ErrorText = {
  identity: uiText('网关身份缺失、无效或与已保存的主机不一致。连接已停止，请确认主机后重新配对。'),
  address: uiText('网关地址无效或候选地址超过 16 个。公网连接必须使用 WSS，地址不能包含账号、查询参数或片段。')
};

// ---------- 身份与地址校验（GatewayIdentity 移植） ----------

function isValidIdentity(value) {
  return IDENTITY_RE.test(String(value || ''));
}

function isLocalHost(hostValue) {
  const host = String(hostValue || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.indexOf('.local') === host.length - 6) return true;
  if (host.indexOf(':') >= 0 &&
      (host.indexOf('fc') === 0 || host.indexOf('fd') === 0 || host.indexOf('fe80:') === 0)) return true;
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (!/^\d{1,3}$/.test(parts[i])) return false;
    const n = Number(parts[i]);
    if (n < 0 || n > 255) return false;
    octets.push(n);
  }
  return octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 169 && octets[1] === 254);
}

/** 校验并归一化单个地址；失败返回 null。对齐 GatewayIdentity.endpoint。 */
function normalizeEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) return null;
  const match = /^(ws|wss):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(raw);
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  const authority = match[2];
  if (match[4] || match[5]) return null; // query / fragment 禁止
  if (authority.indexOf('@') >= 0) return null; // 账号密码禁止
  const hostPort = authority;
  const host = hostPort.replace(/:\d+$/, '');
  if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') return null;
  if (scheme === 'ws' && !isLocalHost(host)) return null;
  let path = match[3] || '';
  if (!path) path = '/ws/mobile';
  return scheme + '://' + hostPort + path;
}

/** 配对载荷地址集合：publicUrl 优先、去重、不超过 16 个。失败返回 null。 */
function normalizeEndpoints(publicUrl, endpoints) {
  const values = [];
  const list = [publicUrl].concat(Array.isArray(endpoints) ? endpoints : []);
  if (list.length - 1 > 16) return null;
  for (let i = 0; i < list.length; i += 1) {
    const value = normalizeEndpoint(list[i]);
    if (value && values.indexOf(value) < 0) values.push(value);
  }
  if (!values.length || values.length > 16) return null;
  return values;
}

// ---------- 设备类型（电脑 / 服务器） ----------
// 网关协议（paired / hello / host）目前不上报主机平台，无法 100% 判断；
// 优先级：配对载荷显式 deviceKind > hostPlatform > 主机名特征 > 默认电脑。
// 默认电脑是因为 DSH 多数跑在个人电脑上；服务器用户在「编辑主机」里手改，
// 手动结果（deviceKindSource=user）不会被自动推断覆盖。

const DEVICE_KINDS = ['desktopcomputer', 'server.rack'];

function normalizeDeviceKind(kind) {
  return DEVICE_KINDS.indexOf(kind) >= 0 ? kind : null;
}

function kindFromPlatform(platform) {
  const value = String(platform || '').trim().toLowerCase();
  if (!value) return null;
  if (/(darwin|mac|ios|win|windows)/.test(value)) return 'desktopcomputer';
  if (/(linux|unix|bsd|ubuntu|debian|centos|rhel|fedora)/.test(value)) return 'server.rack';
  return null;
}

function kindFromName(name) {
  const value = String(name || '').trim().toLowerCase();
  if (!value) return null;
  if (/(macbook|imac|mac-?mini|mac-?studio|surface|thinkpad|ideapad|redmibook|laptop|notebook|desktop|windows|win\d{1,2})/.test(value)) {
    return 'desktopcomputer';
  }
  if (/(vps|server|ubuntu|debian|centos|rocky|alma|rhel|fedora|ec2|gcp|azure|nas|cloud|rack)/.test(value)) {
    return 'server.rack';
  }
  return null;
}

/** 推导设备类型与来源：payload（显式）/ platform / name / default。 */
function deriveDeviceKind(opts) {
  const o = opts || {};
  const explicit = normalizeDeviceKind(o.deviceKind);
  if (explicit) return { kind: explicit, source: 'payload' };
  const platform = kindFromPlatform(o.platform);
  if (platform) return { kind: platform, source: 'platform' };
  const named = kindFromName(o.gatewayName);
  if (named) return { kind: named, source: 'name' };
  return { kind: 'desktopcomputer', source: 'default' };
}

function resolveDeviceKind(opts) {
  return deriveDeviceKind(opts).kind;
}

// ---------- 档案模型 ----------

function newProfile(fields) {
  const f = fields || {};
  return {
    id: f.id || util.uuid(),
    gatewayId: f.gatewayId || null,
    gatewayName: f.gatewayName || uiText('新主机'),
    alias: f.alias || '',
    endpoints: f.endpoints || [],
    preferredEndpoint: f.preferredEndpoint || null,
    remoteDeviceId: f.remoteDeviceId || null,
    lastConnectedAt: f.lastConnectedAt || null,
    deviceKind: normalizeDeviceKind(f.deviceKind) || 'desktopcomputer',
    deviceKindSource: f.deviceKindSource === 'user' ? 'user'
      : (f.deviceKindSource === 'payload' ? 'payload' : 'auto')
  };
}

function displayName(profile) {
  return (profile && profile.alias) ? profile.alias : (profile && profile.gatewayName) || uiText('未命名主机');
}

function kindIconFile(kind) {
  return kind === 'server.rack' ? 'server-white.png' : 'desktop-white.png';
}

/** 首选地址优先的连接候选（GatewayProfile.connectionEndpoints 对齐）。 */
function connectionEndpoints(profile) {
  const result = [];
  const all = (profile && profile.endpoints) || [];
  const ordered = [];
  if (profile && profile.preferredEndpoint && all.indexOf(profile.preferredEndpoint) >= 0) {
    ordered.push(profile.preferredEndpoint);
  }
  for (let i = 0; i < all.length; i += 1) {
    if (ordered.indexOf(all[i]) < 0) ordered.push(all[i]);
  }
  for (let i = 0; i < ordered.length; i += 1) {
    if (result.indexOf(ordered[i]) < 0) result.push(ordered[i]);
  }
  return result;
}

// ---------- 持久化 ----------

function loadProfiles() {
  try {
    let list = wx.getStorageSync(PROFILES_KEY) || [];
    // 微信开发者工具偶尔会按 dataType=Array 保存、却把 data 作为 JSON
    // 字符串返回（重新编译/升级工具后尤其常见）。持久化层必须同时兼容
    // 原生值和序列化值，否则会把已有主机误判成空列表。
    if (typeof list === 'string') {
      try { list = JSON.parse(list); } catch (e) { list = []; }
    }
    if (!Array.isArray(list)) return [];
    const valid = list.filter(function (p) {
      return p && isValidIdentity(p.id) && Array.isArray(p.endpoints) &&
        p.endpoints.length > 0 && p.endpoints.length <= 16;
    });
    // 旧版本按「局域网=电脑 / 公网=服务器」猜测，公网扫码的电脑会被存成服务器。
    // 没有显式来源（user / payload）的档案在加载时按新规则重新推断并落盘。
    let changed = false;
    const repaired = valid.map(function (p) {
      const source = p.deviceKindSource;
      if (source === 'user' || source === 'payload') return p;
      const kind = resolveDeviceKind({ gatewayName: p.gatewayName });
      if (p.deviceKind === kind && source === 'auto') return p;
      changed = true;
      const next = Object.assign({}, p, { deviceKind: kind, deviceKindSource: 'auto' });
      return next;
    });
    if (changed) saveProfiles(repaired);
    return repaired;
  } catch (e) {
    return [];
  }
}

function saveProfiles(list) {
  // 统一写成 JSON 字符串。开发者工具在不同模拟账号分区/重编译后，
  // 对 Array/Object 类型的还原行为不稳定；字符串在真机与工具中一致。
  try { wx.setStorageSync(PROFILES_KEY, JSON.stringify(list || [])); } catch (e) { /* 存储失败不阻断 */ }
}

function loadActiveID() {
  try { return wx.getStorageSync(ACTIVE_ID_KEY) || null; } catch (e) { return null; }
}

function setActiveID(id) {
  try {
    if (id) wx.setStorageSync(ACTIVE_ID_KEY, id);
    else wx.removeStorageSync(ACTIVE_ID_KEY);
  } catch (e) { /* 忽略 */ }
}

function saveCredential(profileId, endpoint, token) {
  try {
    wx.setStorageSync(CRED_PREFIX + profileId, JSON.stringify({ endpoint: endpoint, token: token }));
  } catch (e) { /* 忽略 */ }
}

function loadCredential(profileId) {
  try {
    let value = wx.getStorageSync(CRED_PREFIX + profileId) || null;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (e) { return null; }
    }
    return value;
  } catch (e) { return null; }
}

function forgetCredential(profileId) {
  try { wx.removeStorageSync(CRED_PREFIX + profileId); } catch (e) { /* 忽略 */ }
}

module.exports = {
  ErrorText: ErrorText,
  isValidIdentity: isValidIdentity,
  isLocalHost: isLocalHost,
  normalizeEndpoint: normalizeEndpoint,
  normalizeEndpoints: normalizeEndpoints,
  newProfile: newProfile,
  displayName: displayName,
  kindIconFile: kindIconFile,
  normalizeDeviceKind: normalizeDeviceKind,
  deriveDeviceKind: deriveDeviceKind,
  resolveDeviceKind: resolveDeviceKind,
  connectionEndpoints: connectionEndpoints,
  loadProfiles: loadProfiles,
  saveProfiles: saveProfiles,
  loadActiveID: loadActiveID,
  setActiveID: setActiveID,
  saveCredential: saveCredential,
  loadCredential: loadCredential,
  forgetCredential: forgetCredential
};
