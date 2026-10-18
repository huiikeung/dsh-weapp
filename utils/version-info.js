const build = require('./build');
const GATEWAY_BASELINES = {
  'dsh-plugin-weapp-gateway': '0.8.6',
  'dsh-plugin-mobile-gateway': '0.10.0'
};
function version(value) {
  return typeof value === 'string' && /^v?\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(value.trim()) ? value.trim() : '';
}
function clientVersion(api) {
  let mini = {};
  try { mini = api.getAccountInfoSync().miniProgram || {}; } catch (e) { /* 本地测试或旧基础库。 */ }
  const environment = { develop: '开发版', trial: '体验版', release: '正式版' }[mini.envVersion] || '本地包';
  const current = version(mini.version) || version(build.BUILD_VERSION) || '未提供';
  return {
    appVersion: current + '（' + environment + '）',
    buildLabel: build.BUILD_TIME && build.BUILD_ID ? build.BUILD_TIME + ' · ' + build.BUILD_ID : '未生成构建记录',
    buildNote: '本地打包记录（北京时间），不是主机版本或手机安装时间。'
  };
}
function gatewayVersionInfo(app) {
  const connection = app.connection;
  const metadata = app.gatewayMetadata || {};
  const bundles = app.pluginCatalog && app.pluginCatalog.bundles || [];
  const candidates = bundles.filter(item => item && GATEWAY_BASELINES[item.name] && item.enabled !== false);
  const bundle = metadata.name ? candidates.find(item => item.name === metadata.name) : candidates.length === 1 ? candidates[0] : null;
  const name = GATEWAY_BASELINES[metadata.name] ? metadata.name : bundle && bundle.name || '';
  const current = (name && version(metadata.version)) || (bundle && version(bundle.version)) || '';
  return {
    connectedGatewayVersion: connection !== 'connected' ? '未连接' : current || '未上报',
    minGatewayVersion: name ? (name === 'dsh-plugin-weapp-gateway' ? '小程序网关 ≥ ' : '移动网关 ≥ ') + GATEWAY_BASELINES[name] : '小程序网关 ≥ 0.8.6',
    gatewayVersionHint: '适配基线：小程序网关 0.8.6+；旧版移动网关 0.10.0+。不同插件分别判断，具体功能还取决于主机与协议支持。' + (connection === 'connected' && !current ? ' 当前插件未上报版本，需更新插件后重新连接。' : '')
  };
}
module.exports = { clientVersion, gatewayVersionInfo, GATEWAY_BASELINES, version };
