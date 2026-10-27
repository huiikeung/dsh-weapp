const { isLocalHost, normalizeEndpoint } = require('./hosts')

// 全网络自动选路（Auto Route Selection）。
// 配对载荷把网关地址分成三族，客户端按自己的网络能力挑选，无需用户判断当前在哪个网络：
//   lan    —— ws://（或 wss://）私网/本机地址，局域网直连，最快且不经过公网；
//   public —— wss:// 公网地址，走用户自己的域名/反代/隧道（Cloudflare 等）直连；
//   relay  —— 托管中继（鲸尾公网），域名已列入小程序 socket 合法域名列表。
//
// 两类客户端能用的公网线路完全不同：
//   微信小程序：socket 必须命中合法域名，运营者自己的公网直连地址（Cloudflare 快速隧道
//                每次重启换域名、反代域名也不会逐个登记）基本不可用——硬连只会拿到
//                「url not in domain list」。小程序的公网线路就是托管中继。
//   多端 App / 原生 App：没有合法域名限制，公网直连即可；也没有微信登录，换不到托管
//                中继租赁，不使用中继。
// 协议契约见 docs/auto-route-selection.md；iOS / 鸿蒙端按同一契约实现同源逻辑。

const MAX_ENDPOINTS = 16
const RELAY_NODE_RE = /^[A-Za-z0-9_-]{8,128}$/
const RELAY_KEY_RE = /^[A-Za-z0-9+/]{43}=$/

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
  if (!/^wss:\/\/[^/?#@\s]+(?:\/[^?#\s]*)?$/i.test(relay)) return null
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
    accessExpiresAt: accessExpiresAt
  }
}

function pushUnique(list, value) {
  if (value && list.indexOf(value) < 0) list.push(value)
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
  // 微信小程序：公网 = 托管中继（已配合法域名）+ 局域网；不碰运营者自己的公网直连地址。
  // 多端 App / 原生 App：公网直连 + 局域网；没有微信登录，不碰托管中继。
  return client === 'native' ? ['public', 'lan'] : ['relay', 'lan']
}

/**
 * 把路由表排成有序候选：上次连通的线路优先（preferred），其余按客户端能力排序。
 * options: { client?: 'wechat'|'native', preferred?: string }
 * 返回 [{ endpoint, kind, relay? }]。
 */
function orderCandidates(routeTable, options) {
  const opts = options || {}
  const table = routeTable && typeof routeTable === 'object'
    ? routeTable : { lan: [], public: [], relay: null }
  const client = opts.client === 'native' ? 'native' : 'wechat'
  const ordered = []
  const seen = {}

  function push(endpoint, kind, relay) {
    if (!endpoint || seen[endpoint]) return
    seen[endpoint] = true
    ordered.push(relay ? { endpoint: endpoint, kind: kind, relay: relay } : { endpoint: endpoint, kind: kind })
  }

  if (opts.preferred) {
    // 中继地址（wss://host/c/nodeId）按 URL 特征会被看成公网直连；先用路由表
    // 里的中继条目比对，保证已配对中继档案的首选不会被降级成直连候选。
    if (table.relay && table.relay.endpoint === opts.preferred) {
      push(opts.preferred, 'relay', table.relay)
    } else {
      const kind = classifyEndpoint(opts.preferred)
      if (kind) push(opts.preferred, kind)
    }
  }
  const families = allowedFamilies(client)
  for (let i = 0; i < families.length; i += 1) {
    const family = families[i]
    if (family === 'relay') {
      if (table.relay) push(table.relay.endpoint, 'relay', table.relay)
      continue
    }
    const list = Array.isArray(table[family]) ? table[family] : []
    for (let j = 0; j < list.length; j += 1) push(list[j], family)
  }
  return ordered
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
  parseRouteTable: parseRouteTable,
  allowedFamilies: allowedFamilies,
  orderCandidates: orderCandidates,
  onlyLocalAreaNetwork: onlyLocalAreaNetwork
}
