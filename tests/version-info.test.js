const test = require('node:test');
const assert = require('node:assert/strict');
const { clientVersion, gatewayVersionInfo } = require('../miniprogram/utils/version-info');
const { BUILD_VERSION } = require('../miniprogram/utils/build');
test('client identifies official/trial/local builds without conflating host version', () => {
  assert.equal(clientVersion({getAccountInfoSync:()=>({miniProgram:{version:'1.2.3',envVersion:'release'}})}).appVersion, '1.2.3（正式版）');
  assert.equal(clientVersion({getAccountInfoSync:()=>({miniProgram:{version:'',envVersion:'trial'}})}).appVersion, BUILD_VERSION + '（体验版）');
  assert.doesNotMatch(clientVersion({}).buildLabel, /undefined/);
});
test('gateway versions distinguish new/old packages and never substitute host versions', () => {
  const connected = {connection:'connected',host:{version:'0.1.7-rc.2'}};
  assert.equal(gatewayVersionInfo(connected).connectedGatewayVersion,'未上报');
  const catalog = {bundles:[{name:'dsh-plugin-weapp-gateway',version:'0.8.6'},{name:'dsh-plugin-mobile-gateway',version:'0.10.0'}]};
  assert.equal(gatewayVersionInfo({...connected,pluginCatalog:catalog}).connectedGatewayVersion,'未上报');
  assert.equal(gatewayVersionInfo({...connected,pluginCatalog:catalog,gatewayMetadata:{name:'dsh-plugin-weapp-gateway',version:'0.8.7'}}).connectedGatewayVersion,'0.8.7');
  assert.equal(gatewayVersionInfo({...connected,gatewayMetadata:{name:'dsh-plugin-weapp-gateway'},pluginCatalog:{bundles:[catalog.bundles[1]]}}).connectedGatewayVersion,'未上报');
  assert.equal(gatewayVersionInfo({connection:'disconnected',gatewayMetadata:{name:'dsh-plugin-weapp-gateway',version:'0.8.6'}}).connectedGatewayVersion,'未连接');
});

test('connected gateway version shows the real reported version regardless of package name', () => {
  const connected = {connection:'connected',host:{version:'0.1.7-rc.2'}};
  // hello 只带 gatewayId/gatewayName 的老网关：自报版本但无包名，也要显示真实数据
  assert.equal(gatewayVersionInfo({...connected,gatewayMetadata:{version:'0.8.14'}}).connectedGatewayVersion,'0.8.14');
  // 包名不命中基线时同样优先展示自报版本
  assert.equal(gatewayVersionInfo({...connected,gatewayMetadata:{name:'custom-gateway',version:'1.2.3'}}).connectedGatewayVersion,'1.2.3');
  // 插件目录兜底：网关未自报版本时取唯一启用的网关插件版本
  assert.equal(gatewayVersionInfo({...connected,pluginCatalog:{bundles:[{name:'dsh-plugin-weapp-gateway',version:'0.8.14',enabled:true}]}}).connectedGatewayVersion,'0.8.14');
  // 非语义化版本号不当作真实数据
  assert.equal(gatewayVersionInfo({...connected,gatewayMetadata:{version:'nightly'}}).connectedGatewayVersion,'未上报');
});

test('required gateway version drops the plugin-name prefix and the hint stays accurate', () => {
  const connected = {connection:'connected'};
  assert.equal(gatewayVersionInfo(connected).minGatewayVersion,'≥ 0.8.6');
  assert.equal(gatewayVersionInfo({...connected,gatewayMetadata:{name:'dsh-plugin-weapp-gateway'}}).minGatewayVersion,'≥ 0.8.6');
  assert.equal(gatewayVersionInfo({...connected,pluginCatalog:{bundles:[{name:'dsh-plugin-mobile-gateway',version:'0.10.0',enabled:true}]}}).minGatewayVersion,'≥ 0.10.0');
  const hint = gatewayVersionInfo(connected).gatewayVersionHint;
  assert.match(hint,/^适配基线：0\.8\.6\+；旧版移动网关 0\.10\.0\+/);
  assert.doesNotMatch(hint,/小程序网关/);
  assert.match(gatewayVersionInfo({...connected,gatewayMetadata:{version:'0.8.14'}}).gatewayVersionHint,/^适配基线：0\.8\.6\+/);
  assert.doesNotMatch(gatewayVersionInfo({...connected,gatewayMetadata:{version:'0.8.14'}}).gatewayVersionHint,/当前插件未上报版本/);
  assert.match(hint,/当前插件未上报版本/);
});
