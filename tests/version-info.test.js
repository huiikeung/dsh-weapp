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
  assert.match(gatewayVersionInfo({...connected,pluginCatalog:{bundles:[catalog.bundles[1]]}}).minGatewayVersion,/移动网关 ≥ 0.10.0/);
  assert.equal(gatewayVersionInfo({connection:'disconnected',gatewayMetadata:{name:'dsh-plugin-weapp-gateway',version:'0.8.6'}}).connectedGatewayVersion,'未连接');
});
