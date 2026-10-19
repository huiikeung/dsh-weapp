const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'miniprogram');
const read = file => { const text = fs.readFileSync(path.join(root, file), 'utf8'); return file.endsWith('.wxml') ? text.replace(/\{\{ui\['([^']+)'\]\}\}/g, '$1') : text; };

test('sidebar application settings and home session settings have separate entries and modules', () => {
  const home = read('pages/home/home.wxml');
  const settings = read('pages/settings/settings.wxml');
  const sessions = read('pages/session-settings/session-settings.wxml');
  assert.match(home, /drawer-footer[\s\S]*?bindtap="openSettings"/);
  assert.match(home, /catchtap="openSessionSettings"[\s\S]*?sliders-white.svg/);
  assert.match(home, /catchtap="openPairGuide"[\s\S]*?setup-guide-white.svg/);
  assert.match(home, /catchtap="togglePairMenu"[\s\S]*?person-key-white.svg/);
  assert.doesNotMatch(home, /ic-pair-auth.png/);
  assert.doesNotMatch(home, /g-head|g-ring|g-tooth/);
  assert.match(read('pages/home/home.js'), /openSessionSettings\(\)[\s\S]*?pages\/session-settings\/session-settings/);
  for (const label of ['公网访问', '节点管理', '微信身份', '管理员', '外观', '实验性功能', '关于']) {
    assert.ok(settings.includes('>' + label + '</view>'), label);
    assert.ok(!sessions.includes('>' + label + '</view>'), label);
  }
  for (const label of ['新会话默认配置', '功能', '主机信息']) {
    assert.ok(sessions.includes('>' + label + '</view>'), label);
    assert.ok(!settings.includes('>' + label + '</view>'), label);
  }
  assert.ok(!settings.includes('工作区文件'));
  assert.match(sessions, /bindtap="openFiles"[^>]*><text[^>]*>工作区文件/);
  assert.ok(JSON.parse(read('app.json')).pages.includes('pages/session-settings/session-settings'));
  assert.equal(JSON.parse(read('pages/session-settings/session-settings.json')).navigationBarTitleText, '会话设置');
  assert.match(read('pages/home/home.wxss'), /\.drawer-footer[^}]*margin-top: auto/);
});

test('session settings retain model and permission APIs, file navigation and privacy-safe diagnostics', async () => {
  let definition, subscriber; const calls = [];
  const state = { connection: 'connected', activeID: 'node', profiles: [{id: 'node', relay: true, gatewayId: 'public-id'}], endpoint: 'wss://hidden.example/relay/c/node',
    defaults: { agentPresetDefault: 'code', permissionDefault: 'read-only' }, defaultModel: {model: 'fixture-model'}, host: {version: '1.0'},
    agentPresets: {presets: [{id:'code', name:'编程'}]}, modelCatalog: {groups:[{id:'fixture',name:'测试',models:[{id:'next',name:'模型'}]}]} };
  const store = { state, subscribe(fn) { subscriber = fn; return () => calls.push(['unsubscribe']); },
    client: { requestHost() {calls.push(['host']);}, setDefault: async (...args) => calls.push(args), saveDefaultModel: async (...args) => calls.push(args) } };
  const wx = { showActionSheet(o) { wx.sheet = o; }, showModal() { throw Error('Must use bottom sheet'); }, showToast() {}, navigateTo(o) {calls.push(['navigate',o.url]);} };
  vm.runInNewContext(read('pages/session-settings/session-settings.js'), {Page: d=>{definition=d;},wx,require: name=>{
    if(name.endsWith('/ui-preferences'))return require('../miniprogram/utils/ui-preferences');
    if(name.endsWith('/store'))return store;
    if(name.endsWith('/theme'))return {applyTo(){}};
    if(name.endsWith('/labels'))return {presetModeName:v=>v,permissionName:v=>v};
    if(name.endsWith('/node-presentation'))return require('../miniprogram/utils/node-presentation');
    if(name.endsWith('/host-info'))return require('../miniprogram/utils/host-info');
    if(name.endsWith('/version-info'))return require('../miniprogram/utils/version-info');
    if(name.endsWith('/build'))return {BUILD_TIME:'fixture'};
    throw Error('Unexpected dependency '+name);
  }});
  const page={...definition,data:{...definition.data},setData(v){Object.assign(this.data,v);}};
  page.onLoad(); assert.equal(page.data.presetLabel,'编程'); assert.equal(page.data.modelLabel,'fixture-model');
  wx.getMenuButtonBoundingClientRect = () => ({top: 60, height: 32});
  page.onResize(); assert.equal(page.data.navPadTop + page.data.navHeight / 2, 76);
  wx.navigateBack = o => {calls.push(['back']); wx.backOptions=o;};
  wx.reLaunch = o => calls.push(['relaunch',o.url]);
  page.goBack(); assert.deepEqual(calls.at(-1),['back']);
  wx.backOptions.fail(); assert.deepEqual(calls.at(-1),['relaunch','/pages/home/home']);
  page.pickAgentPreset(); wx.sheet.success({tapIndex:0}); assert.deepEqual(calls.at(-1),['agent-preset','code']);
  page.pickDefaultPermission(); wx.sheet.success({tapIndex:1}); assert.deepEqual(calls.at(-1),['permission','workspace-write']);
  page.pickDefaultModel(); wx.sheet.success({tapIndex:0}); assert.deepEqual(calls.at(-1),['fixture','next',undefined]);
  page.openFiles(); assert.deepEqual(calls.at(-1),['navigate','/pages/files/files']);
  page.showDiagnostics(); assert.equal(page.data.utilitySheet,'diagnostics'); assert.equal(page.data.diagnostics[1].label,'公网标识'); assert.equal(page.data.diagnostics[1].value,'public-id'); assert.doesNotMatch(JSON.stringify(page.data.diagnostics),/hidden.example/);
  subscriber({app:{...state,defaultModel:{model:'changed'}}}); assert.equal(page.data.modelLabel,'changed');
  assert.equal(page.data.hostInfo.model, 'changed');
  assert.equal(page.data.hostInfo.version, '1.0');
  subscriber({app:{...state,host:{version:'remote-gateway',dshVersion:'0.1.7-rc.2',defaultProvider:'fixture',defaultModel:'next'},defaultModel:null}});
  assert.equal(page.data.hostInfo.version,'0.1.7-rc.2'); assert.equal(page.data.hostInfo.provider,'测试'); assert.equal(page.data.hostInfo.model,'模型');
  subscriber({app:{...state,connection:'disconnected'}}); assert.equal(page.data.diagnostics[0].value,'未连接');
  page.closeUtilitySheet(); assert.equal(page.data.utilitySheet,'');
  const removed = [];
  wx.getStorageInfoSync = () => ({keys:['dsh_session_cache.fixture','dsh_home_cache.fixture','gateway.profiles.v1','dsh_creds.fixture','public-access.session.v1']});
  wx.removeStorageSync = key => removed.push(key);
  page.clearLocalCache(); assert.equal(removed.length,0,'Opening confirmation must not delete anything');
  page.closeUtilitySheet(); page.confirmClearCache(); assert.equal(removed.length,0,'Cancelled sheet cannot delete');
  page.clearLocalCache(); page.confirmClearCache();
  assert.deepEqual(removed,['dsh_session_cache.fixture','dsh_home_cache.fixture']); assert.equal(page.data.utilitySheet,'');
  wx.getStorageInfoSync = () => {throw Error('unavailable');};
  page.clearLocalCache(); page.confirmClearCache(); assert.equal(page.data.utilitySheet,'cache'); assert.match(page.data.cacheError,/无法读取/);
  wx.getStorageInfoSync = () => ({keys:['dsh_session_cache.fixture']}); wx.removeStorageSync = () => {throw Error('locked');};
  page.confirmClearCache(); assert.match(page.data.cacheError,/未清理/); assert.equal(page.data.cacheClearing,false);
  page.onHide(); assert.equal(page.data.utilitySheet,'');
  for(const match of read('pages/session-settings/session-settings.wxml').matchAll(/bindtap="([^"]+)"/g))assert.equal(typeof page[match[1]],'function',match[1]);
  page.onUnload(); assert.deepEqual(calls.at(-1),['unsubscribe']);
});

test('settings back controls use inset spacing and customer service stays a full-width native action', () => {
  const css = read('pages/settings/settings.wxss');
  assert.match(css, /\.settings \.nav\s*\{[^}]*margin-left:\s*0;/);
  assert.equal(JSON.parse(read('pages/session-settings/session-settings.json')).navigationStyle, 'custom');
  assert.match(read('pages/session-settings/session-settings.wxml'), /class="session-nav-back" bindtap="goBack"/);
  assert.match(read('pages/session-settings/session-settings.wxss'), /\.session-settings\s*\{[^}]*padding:\s*0 40rpx/);
  assert.match(read('pages/settings/settings.wxml'), /<button class="card-row about-contact" open-type="contact"/);
  assert.match(read('pages/settings/settings.wxml'), /<text class="card-row-label">客户端<\/text>\s*<text class="card-row-value">鲸尾助手小程序版<\/text>/);
  assert.match(css, /\.settings \.card-row\.about-contact\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;[^}]*margin:\s*0;[^}]*padding:\s*30rpx 32rpx;[^}]*justify-content:\s*space-between/);
});

test('settings retry label and inherited text follow the manually selected theme', () => {
  const html = read('pages/settings/settings.wxml');
  const css = read('pages/settings/settings.wxss');
  assert.match(html, /bindtap="refreshAppContent"[^>]*><text class="card-row-label">重试同步分享设置<\/text>/);
  assert.doesNotMatch(html, /btn-text-primary/);
  assert.match(css, /\.settings\s*\{[^}]*color:\s*var\(--text\)/);
  const globalCss = read('app.wxss');
  assert.match(globalCss, /\.card-row-label\s*\{[^}]*color:\s*var\(--ink\)/);
  assert.match(globalCss, /\.theme-dark\s*\{[^}]*--ink:\s*#F1F4FA/);
  assert.match(globalCss, /\.theme-light\s*\{[^}]*--ink:\s*#101318/);
});

test('utility panels are bottom sheets with theme colors and concise feature labels', () => {
  const html=read('pages/session-settings/session-settings.wxml');
  const css=read('pages/session-settings/session-settings.wxss');
  assert.doesNotMatch(html,/row-desc|查看并启停|管理已创建|连接状态、帧/);
  assert.match(html,/utility-mask.*catchtap="closeUtilitySheet"/);
  assert.match(html,/bindtap="confirmClearCache"/);
  assert.match(css,/\.utility-mask[^}]*align-items: flex-end/);
  assert.match(css,/\.utility-sheet[^}]*env\(safe-area-inset-bottom\)[^}]*background: var\(--surface\)/);
  assert.match(css,/\.theme-dark.*utility-confirm/);
});
