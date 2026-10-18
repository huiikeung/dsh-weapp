'use strict';
// Narrow, idempotent transformations: never replace the whole gateway/UI.
function replaceKnown(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error('无法识别插件的' + label + '，未修改；请使用兼容版本');
  }
  return source.replace(before, after);
}
function customizeClient(source) {
  const edits = [
    ["React.createElement('option', { value: 'relay' }, '中继 · 小程序')", "React.createElement('option', { value: 'relay' }, '鲸尾公网 · 小程序')", '公网选项'],
    ['`已注册的中继：${relayInfo.relay}`', "'鲸尾公网服务 · 已注册'", '公网服务名称'],
    ['`nodeId ${relayInfo.nodeId.slice(0, 8)}… · ${relayInfo.gatewayName}`', '`设备 ID ${relayInfo.nodeId.slice(0, 8)}… · ${relayInfo.gatewayName}`', '设备标识'],
    ['外网必须走中继：小程序只能连接已配置的域名、且基本限于 443 端口，带端口的公网地址它连不上。', '连接地址由插件自动配置，无需填写。用户在小程序兑换公网有效期后，扫描本机二维码连接。', '配对说明'],
    ['中继链路已验证可用。若扫码后仍报「地址未经此主机确认」，请确认小程序版本支持中继协议（v3 载荷）。', '设备配对与公网有效期独立；公网到期不影响局域网。已注册不代表手机端完整链路已通过验证。', '权限说明'],
    ['`自动启动内置连接器失败：${relayConnector.lastError}`', "'公网连接器暂时不可用，请检查网络或重新开启公网连接。'", '错误提示'],
    ["React.createElement('label', { style: styles.label }, pairingMode === 'relay' ? '网关地址（仅透传给小程序）' : 'WebSocket 地址'),\n            pairingMode === 'relay'\n              ? React.createElement('p', { style: { ...styles.muted, margin: '-4px 0 8px' } }, '中继模式下小程序不直连它；它只作为 gatewayUrl 出现在配对载荷里，供客户端展示。')\n              : null,\n            React.createElement('input', { style: styles.input, value: publicUrl, onChange: (event) => { choosePairingRoute('custom'); setPublicUrl(event.target.value) }, placeholder: 'ws://192.168.1.10:3081/ws/mobile', spellCheck: false }),",
     "pairingMode !== 'relay' ? React.createElement('label', { style: styles.label }, 'WebSocket 地址') : null,\n            pairingMode !== 'relay' ? React.createElement('input', { style: styles.input, value: publicUrl, onChange: (event) => { choosePairingRoute('custom'); setPublicUrl(event.target.value) }, placeholder: 'ws://192.168.1.10:3081/ws/mobile', spellCheck: false }) : null,", '地址输入区域'],
  ];
  for (const edit of edits) source = replaceKnown(source, ...edit);
  return source;
}
function customizeSupervisor(source) {
  const anchor = '  let child = null';
  const configured = "  // Whale public service is configured internally, not a user-facing domain.\n  const configuredRelay = String(relay || '').replace(/[/]$/, '')\n  relay = ['', 'wss://relay.ahwe.top', 'wss://relay.ahwe.top/relay'].includes(configuredRelay)\n    ? 'wss://dsh.ahwe.top/relay' : configuredRelay\n" + anchor;
  source = replaceKnown(source, anchor, configured, '连接器默认配置');
  source = replaceKnown(source, '          ...process.env,\n', "          ...process.env,\n          // Desktop runs under Electron; child scripts must execute as Node.\n          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),\n", 'Electron 运行环境');
  return source;
}
function customizeGatewayMetadata(source) {
  if (!source.includes('PLUGIN_VERSION')) throw new Error('无法识别插件版本来源，未修改');
  source = replaceKnown(source, "            kind: 'hello',\n            ...gatewayIdentity,", "            kind: 'hello',\n            gatewayPackage: 'dsh-plugin-weapp-gateway',\n            gatewayVersion: PLUGIN_VERSION,\n            ...gatewayIdentity,", '握手版本元数据');
  source = replaceKnown(source, "return proxyQuery(api, 'host', api.host.describe.bind(api.host), {})", "return proxyQuery(api, 'host', async () => ({ ...(await api.host.describe()), gatewayPackage: 'dsh-plugin-weapp-gateway', gatewayVersion: PLUGIN_VERSION }), {})", '主机查询网关版本');
  return source;
}
module.exports = { customizeClient, customizeSupervisor, customizeGatewayMetadata };
