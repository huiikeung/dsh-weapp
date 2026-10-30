const { isLocalHost, normalizeEndpoint } = require('./hosts')

// ASCF route selection consumes the same pairing routes as other clients, but it
// is a separate HarmonyOS runtime with its own WSS and configured-domain policy.
// This module filters to syntactically valid WSS candidates; it does not claim to
// verify Huawei developer-center domain allowlists. Platform/project configuration
// remains responsible for domain authorization.
// Legacy WeChat and native route families remain available to shared protocol code.

const MAX_ENDPOINTS = 16
const RELAY_NODE_RE = /^[A-Za-z0-9_-]{8,128}$/
const RELAY_KEY_RE = /^[A-Za-z0-9+/]{43}=$/
const RELAY_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/

/** 从 normalizeEndpoint 的归一化结果里取主机名（去端口）。 */
function endpointHost(endpoint) {
  const authority = String(endpoint).split('://')[1] || ''
  return authority.split('/')[0].replace(/:\d+$/, '')
}

/**
 * 单个地址归类：'lan' | 'public' | null（无效地址）。
 * normalizeEndpoint 已保证 ws:// 只允许私网/本机，wss:// 任意主机；
 * wss 指向私网地址仍算局域网（只是套了 TLS）。
 */
function classifyEndpoint(value) {
  const endpoint = normalizeEndpoint(value)
  if (!endpoint) return null
  const host = endpointHost(endpoint)
  if (!host) return null
  if (/^wss:/i.test(endpoint)) return isLocalHost(host) ? 'lan' : 'public'
  return 'lan'
}

/** 中继条目校验：relay 必须是公网 wss，nodeId/agentPubKey 与配对协议同规格。 */
function normalizeRelay(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const relay = String(value.relay || '').trim()
  const nodeId = String(value.nodeId || '').trim()
  const agentPubKey = String(value.agentPubKey || '').trim()
  if (!/^wss:\/\/[^/?#@\s]+(?:\/[^?#\s]*)?$/i.test(relay) || !normalizeASCFEndpoint(relay)) return null
  if (!RELAY_NODE_RE.test(nodeId) || !RELAY_KEY_RE.test(agentPubKey)) return null
  const endpoint = relay.replace(/\/$/, '') + '/c/' + nodeId
  const authMode = value.authMode === 'gateway' ? 'gateway' : 'invite'
  const accessExpiresAt = Number.isSafeInteger(value.accessExpiresAt) && value.accessExpiresAt > 0
    ? value.accessExpiresAt : null
  return {
    relay: relay.replace(/\/$/, ''),
    nodeId: nodeId,
    agentPubKey: agentPubKey,
    endpoint: endpoint,
    gatewayName: typeof value.gatewayName === 'string' && value.gatewayName.trim()
      ? value.gatewayName.trim().slice(0, 80) : null,
    authMode: authMode,
    accessExpiresAt: accessExpiresAt,
    inviteToken: RELAY_TOKEN_RE.test(String(value.inviteToken || '')) ? String(value.inviteToken) : null,
    role: value.role === 'owner' ? 'owner' : 'guest'
  }
}

function pushUnique(list, value) {
  if (value && list.indexOf(value) < 0) list.push(value)
}

/** ASCF direct routes must be syntactically valid WSS endpoints. */
function normalizeASCFEndpoint(value) {
  const endpoint = normalizeEndpoint(value)
  if (!endpoint || !/^wss:\/\//i.test(endpoint) || /[\s\\]/.test(endpoint)) return null
  const authority = endpoint.split('://')[1].split('/')[0]
  if (!authority || authority.indexOf('@') >= 0) return null
  let port = null
  if (authority[0] === '[') {
    const match = /^\[([0-9a-f:.]+)\](?::(\d+))?$/i.exec(authority)
    if (!match || match[1].indexOf(':') < 0) return null
    port = match[2]
  } else {
    const match = /^([^:]+)(?::(\d+))?$/.exec(authority)
    if (!match) return null
    port = match[2]
  }
  if (port && (Number(port) < 1 || Number(port) > 65535)) return null
  return endpoint
}

function isRelayEndpoint(endpoint) {
  const path = String(endpoint).split('://')[1].split('/').slice(1).join('/')
  return /(?:^|\/)c\/[A-Za-z0-9_-]{8,128}$/.test(path)
}

function sanitizeASCFRouteTable(source) {
  const input = source && typeof source === 'object' ? source : {}
  const table = { lan: [], public: [], relay: normalizeRelay(input.relay) }
  const values = (Array.isArray(input.public) ? input.public : [])
    .concat(Array.isArray(input.lan) ? input.lan : [])
  const seen = []
  const maxDirect = MAX_ENDPOINTS - (table.relay ? 1 : 0)
  for (let i = 0; i < values.length && seen.length < maxDirect; i += 1) {
    const endpoint = normalizeASCFEndpoint(values[i])
    if (!endpoint || isRelayEndpoint(endpoint) || seen.indexOf(endpoint) >= 0) continue
    const family = classifyEndpoint(endpoint)
    if (family !== 'lan' && family !== 'public') continue
    seen.push(endpoint)
    pushUnique(table[family], endpoint)
  }
  return table
}

/**
 * 解析配对载荷里的路由表。优先使用显式 routes 字段；老载荷没有 routes 时
 * 从 publicUrl + endpoints 推导，保证旧插件生成的二维码也能自动选路。
 * 返回 { lan: string[], public: string[], relay: null|{...} }。
 */
function parseRouteTable(payload) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const table = { lan: [], public: [], relay: null }
  const routes = source.routes && typeof source.routes === 'object' && !Array.isArray(source.routes)
    ? source.routes : null
  if (routes) {
    const lan = Array.isArray(routes.lan) ? routes.lan : []
    const pub = Array.isArray(routes.public) ? routes.public : []
    for (let i = 0; i < lan.length && table.lan.length < MAX_ENDPOINTS; i += 1) {
      if (classifyEndpoint(lan[i]) === 'lan') pushUnique(table.lan, normalizeEndpoint(lan[i]))
    }
    for (let i = 0; i < pub.length && table.public.length < MAX_ENDPOINTS; i += 1) {
      if (classifyEndpoint(pub[i]) === 'public') pushUnique(table.public, normalizeEndpoint(pub[i]))
    }
    table.relay = normalizeRelay(routes.relay)
    return table
  }
  // 老载荷：publicUrl 优先，其余按地址特征归类。
  const legacy = [source.publicUrl].concat(Array.isArray(source.endpoints) ? source.endpoints : [])
  for (let i = 0; i < legacy.length; i += 1) {
    const kind = classifyEndpoint(legacy[i])
    const endpoint = normalizeEndpoint(legacy[i])
    if (!kind || !endpoint) continue
    if (table.lan.length + table.public.length >= MAX_ENDPOINTS) break
    if (kind === 'lan') pushUnique(table.lan, endpoint)
    else pushUnique(table.public, endpoint)
  }
  return table
}

/** 该客户端能使用哪些线路族（按尝试顺序）。 */
function allowedFamilies(client) {
  if (client === 'ascf') return ['public', 'lan', 'relay']
  // 微信小程序：公网 = 托管中继（已配合法域名）+ 局域网；不碰运营者自己的公网直连地址。
  // 多端 App / 原生 App：公网直连 + 局域网；没有微信登录，不碰托管中继。
  return client === 'native' ? ['public', 'lan'] : ['relay', 'lan']
}

/**
 * 把路由表排成有序候选：上次连通的线路优先（preferred），其余按客户端能力排序。
 * options: { client?: 'wechat'|'native', preferred?: string }
 * 返回 [{ endpoint, kind, relay? }]。
 */
/**
 * 网络类型 → 线路族。wifi 下局域网「可能」可达（也可能不是同一个网），
 * cellular 下局域网地址一定不可达。'' 表示未知/无网，由调用方决定。
 */
function networkFamily(networkType) {
  const type = String(networkType || '').toLowerCase()
  if (type === 'wifi') return 'wifi'
  if (/^(?:2g|3g|4g|5g|cellular)$/.test(type)) return 'cellular'
  return ''
}

function orderCandidates(routeTable, options) {
  const opts = options || {}
  const input = routeTable && typeof routeTable === 'object'
    ? routeTable : { lan: [], public: [], relay: null }
  const client = opts.client === 'ascf' ? 'ascf' : (opts.client === 'native' ? 'native' : 'wechat')
  const table = client === 'ascf' ? sanitizeASCFRouteTable(input) : input
  const network = networkFamily(opts.network)
  // 蜂窝下局域网一条都不可达，整族不列。但这只是优化：不能因过滤后无候选
  // 而永久停止重连；空列表时仍回退到原始网络族集合。
  const dropLan = network === 'cellular'

  function build(skipLan) {
    const ordered = []
    const seen = {}
    const push = (endpoint, kind, relay) => {
      if (!endpoint || seen[endpoint]) return
      seen[endpoint] = true
      ordered.push(relay ? { endpoint: endpoint, kind: kind, relay: relay } : { endpoint: endpoint, kind: kind })
    }
    const kindOf = (endpoint) => {
      if (table.relay && table.relay.endpoint === endpoint) return 'relay'
      return classifyEndpoint(endpoint)
    }
    const preferred = client === 'ascf' ? normalizeASCFEndpoint(opts.preferred) : opts.preferred
    const detectedPreferredKind = preferred ? kindOf(preferred) : null
    const preferredIsAllowed = !!preferred && (client !== 'ascf' ||
      detectedPreferredKind === 'relay' || table.public.indexOf(preferred) >= 0 || table.lan.indexOf(preferred) >= 0)
    const preferredKind = preferredIsAllowed ? detectedPreferredKind : null
    const skipPreferred = preferredIsAllowed && (
      (skipLan && preferredKind === 'lan') ||
      (opts.promoteLan === true && preferredKind !== 'lan')
    )
    if (preferredIsAllowed && !skipPreferred) {
      push(preferred, preferredKind, preferredKind === 'relay' ? table.relay : null)
    }
    let families = allowedFamilies(client)
    if (opts.promoteLan === true && families.indexOf('lan') >= 0) {
      families = ['lan'].concat(families.filter((family) => family !== 'lan'))
    }
    for (let i = 0; i < families.length; i += 1) {
      const family = families[i]
      if (skipLan && family === 'lan') continue
      if (family === 'relay') {
        if (table.relay) push(table.relay.endpoint, 'relay', table.relay)
        continue
      }
      const list = Array.isArray(table[family]) ? table[family] : []
      for (let j = 0; j < list.length; j += 1) push(list[j], family)
    }
    return ordered
  }

  const filtered = build(dropLan)
  if (dropLan && !filtered.length) return build(false)
  return filtered
}

/** 候选是否只剩局域网（用于给出「二维码只含局域网地址」的明确提示）。 */
function onlyLocalAreaNetwork(candidates) {
  return candidates.length > 0 && candidates.every(candidate => candidate.kind === 'lan')
}

module.exports = {
  MAX_ENDPOINTS: MAX_ENDPOINTS,
  classifyEndpoint: classifyEndpoint,
  endpointHost: endpointHost,
  normalizeRelay: normalizeRelay,
  normalizeASCFEndpoint: normalizeASCFEndpoint,
  parseRouteTable: parseRouteTable,
  allowedFamilies: allowedFamilies,
  networkFamily: networkFamily,
  orderCandidates: orderCandidates,
  onlyLocalAreaNetwork: onlyLocalAreaNetwork
}
