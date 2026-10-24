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
  const panelSettings = settings.slice(settings.indexOf('会话面板'));
  assert.match(panelSettings, /checked="\{\{showContextPanel\}\}"[\s\S]*?bindchange="toggleContextPanel"[\s\S]*?checked="\{\{showFleetPanel\}\}"[\s\S]*?bindchange="toggleFleetPanel"/);
  assert.match(read('pages/settings/settings.js'), /toggleContextPanel\(e\)[\s\S]*?contextPanelsPreference\.set\('context'/);
  assert.match(read('pages/settings/settings.js'), /toggleFleetPanel\(e\)[\s\S]*?contextPanelsPreference\.set\('fleet'/);
  for (const label of ['新会话默认配置', '功能', '主机信息']) {
    assert.ok(sessions.includes('>' + label + '</view>'), label);
    assert.ok(!settings.includes('>' + label + '</view>'), label);
  }
  assert.ok(!settings.includes('工作区文件'));
  // 会话设置的功能/主机信息精简：这些入口和版本行已移除
  assert.doesNotMatch(sessions, /bindtap="openFiles"[^>]*><text[^>]*>工作区文件/);
  for (const handler of ['openPlugins', 'openSchedule']) assert.ok(!sessions.includes('bindtap="' + handler + '"'), handler);
  for (const label of ['小程序版本', '构建记录', '主机版本']) assert.ok(!sessions.includes('>' + label + '</text>'), label);
  // 「会话设置」在分包里按需加载：主包页面只负责 navigateTo，路径保持不变。
  const appJson = JSON.parse(read('app.json'));
  assert.ok(!appJson.pages.includes('pages/session-settings/session-settings'));
  assert.ok(appJson.subPackages.some(pkg => pkg.root === 'pages/session-settings' && pkg.pages.includes('session-settings')));
  assert.equal(JSON.parse(read('pages/session-settings/session-settings.json')).navigationBarTitleText, '会话设置');
  // 设置入口贴在抽屉底部：贴底职责由包住卡片的 .drawer-bottom 承担（margin-top:auto），
  // 额度卡片与设置入口同在 .drawer-bottom 内，卡片位于设置上方。
  assert.match(read('pages/home/home.wxss'), /\.drawer-bottom[^}]*margin-top: auto/);
  assert.match(home, /<view class="drawer-bottom">[\s\S]*?drawer-footer[\s\S]*?bindtap="openSettings"/);
});

test('session settings retain model and permission APIs, file navigation and privacy-safe diagnostics', async () => {
  let definition, subscriber; const calls = [], accountRequests = [];
  const state = { connection: 'connected', activeID: 'node', currentWorkspaceId: 'workspace-1', profiles: [{id: 'node', relay: true, gatewayId: 'public-id'}], endpoint: 'wss://hidden.example/relay/c/node',
    defaults: { agentPresetDefault: 'code', permissionDefault: 'read-only' }, defaultModel: {model: 'fixture-model'}, host: {version: '1.0'},
    agentPresets: {authorable: false, presets: [{id:'code', name:'编程', description:'用于编码工作'}, {id:'cordis', name:'创造模式'}]}, modelCatalog: {groups:[{id:'fixture',name:'测试',models:[{id:'next',name:'模型'},{id:'thinking',name:'思考模型',reasoning:{efforts:[{id:'off',name:'Off'},{id:'low',name:'Low'},{id:'high',name:'High'}],defaultEffort:'low'}}]}]} };
  const store = { state, subscribe(fn) { subscriber = fn; return () => calls.push(['unsubscribe']); },
    client: { requestHost() {calls.push(['host']);}, requestAccount: async client => { accountRequests.push(client); return { state: { status: 'credential-stored' }, balance: { status: 'ready', value: [{ currency: 'CNY', balance: '12.34' }] } }; }, requestAgentPresets: async () => { calls.push(['agent-presets']); return {authorable:false,presets:[{id:'cordis'}]}; }, setDefault: async (...args) => calls.push(args), saveDefaultModel: async (...args) => calls.push(args),
      requestFileList: async () => ({ entries: [{ name: 'README.md', path: 'README.md', kind: 'file', bytes: 10 }] }) } };
  const wx = { showActionSheet(o) { wx.sheet = o; }, showModal() { throw Error('Must use bottom sheet'); }, showToast() {}, navigateTo(o) {calls.push(['navigate',o.url]);} };
  vm.runInNewContext(read('pages/session-settings/session-settings.js'), {Page: d=>{definition=d;},wx,
    getCurrentPages: () => [{route:'pages/home/home'},{route:'pages/session-settings/session-settings'}],
    require: name=>{
    if(name.endsWith('/ui-preferences'))return require('../miniprogram/utils/ui-preferences');
    if(name.endsWith('/store'))return store;
    if(name.endsWith('/theme'))return {applyTo(){}};
    if(name.endsWith('/labels'))return {presetModeName:v=>v,presetModeBlurb:v=>'描述 '+v,reasoningEffortName:v=>({off:'Off',low:'Low',high:'High'}[v]||v),permissionName:v=>v,permissionIconFile:v=>require('../miniprogram/utils/labels').permissionIconFile(v)};
    if(name.endsWith('/node-presentation'))return require('../miniprogram/pages/settings/utils/node-presentation');
    if(name.endsWith('/connection-status'))return require('../miniprogram/utils/connection-status');
    if(name.endsWith('/host-info'))return require('../miniprogram/utils/host-info');
    if(name.endsWith('/version-info'))return require('../miniprogram/pages/settings/utils/version-info');
    if(name.endsWith('/account-view'))return require('../miniprogram/pages/settings/utils/account-view');
    if(name.endsWith('/build'))return {BUILD_TIME:'fixture',BUILD_VERSION:'0.9.27'};
    throw Error('Unexpected dependency '+name);
  }});
  const page={...definition,data:{...definition.data},setData(v){Object.assign(this.data,v);}};
  page.onLoad(); await Promise.resolve(); await Promise.resolve();
  assert.equal(page.data.presetLabel,'编程'); assert.equal(page.data.modelLabel,'fixture-model');
  assert.equal(accountRequests[0].version, '1.0', 'Session settings send the DSH Host version, not the mini-program version');
  assert.equal(page.data.dshAccount.balanceText, '¥12.34');
  assert.equal(page.data.dshAccountVisible, true, 'connected session settings show the account area');
  wx.getMenuButtonBoundingClientRect = () => ({top: 60, height: 32});
  page.onResize(); assert.equal(page.data.navPadTop + page.data.navHeight / 2, 76);
  wx.navigateBack = o => {calls.push(['back']); wx.backOptions=o;};
  wx.reLaunch = o => calls.push(['relaunch',o.url]);
  page.goBack(); assert.deepEqual(calls.at(-1),['back']);
  wx.backOptions.fail(); assert.deepEqual(calls.at(-1),['relaunch','/pages/home/home']);
  // 预设/权限/模型改为自绘底部弹窗（非系统 ActionSheet）
  page.pickAgentPreset(); assert.equal(page.data.picker,'preset'); assert.equal(page.data.presetCreatorAvailable,true);
  assert.equal(page.data.pickerIntro,'预设决定 Agent 使用的工具、提示词与能力。选择后只对新建会话生效。');
  assert.equal(page.data.pickerOptions.find(o=>o.id==='code').description,'用于编码工作');
  assert.match(read('pages/session-settings/session-settings.wxml'), /picker === 'preset'[\s\S]*?presetCreatorAvailable[\s\S]*?createCustomAgentPreset/);
  const presetIndex = page.data.pickerOptions.findIndex(o => o.id === 'code');
  page.choosePicker({ currentTarget: { dataset: { index: presetIndex } } });
  assert.deepEqual(calls.filter(c => c[0] === 'agent-preset').at(-1),['agent-preset','code']);
  page.pickDefaultPermission(); assert.equal(page.data.picker,'permission');
  assert.deepEqual(Array.from(page.data.pickerOptions, o=>o.label),['仅可查看','工作区内修改','完全权限','自动审查']);
  assert.deepEqual(Array.from(page.data.pickerOptions, o=>o.icon),['shield-check-gray.png','shield-write-gray.png','shield-excla-gray.png','shield-auto-gray.svg']);
  assert.equal(page.data.pickerOptions.find(o=>o.id==='auto').badge,'EXP');
  assert.ok(page.data.pickerOptions.find(o=>o.id==='read-only').checked);
  const permissionIndex = page.data.pickerOptions.findIndex(o => o.id === 'workspace-write');
  page.choosePicker({ currentTarget: { dataset: { index: permissionIndex } } });
  assert.deepEqual(calls.filter(c => c[0] === 'permission').at(-1),['permission','workspace-write']);
  page.pickDefaultModel(); assert.equal(page.data.picker,'model');
  assert.equal(page.data.pickerIntro,'为之后新建的会话设置默认模型与思考等级。这会更新部署级设置，同步影响 WebUI，运行中的会话保持启动时的配置。');
  assert.equal(page.data.pickerOptions.find(o=>o.model==='thinking').efforts.length,3);
  const modelIndex = page.data.pickerOptions.findIndex(o => !o.header && o.model === 'next');
  page.choosePicker({ currentTarget: { dataset: { index: modelIndex } } });
  assert.deepEqual(calls.at(-1),['fixture','next','']);
  state.defaultModel = {provider:'fixture', model:'thinking', reasoningEffort:'high'};
  page.syncFromStore({app:state});
  assert.equal(page.data.modelLabel,'思考模型 · High');
  page.pickDefaultModel();
  const thinkingIndex = page.data.pickerOptions.findIndex(o => !o.header && o.model === 'thinking');
  assert.equal(page.data.pickerOptions[thinkingIndex].checked,true);
  assert.equal(page.data.pickerOptions[thinkingIndex].efforts[2].checked,true);
  assert.deepEqual(Array.from(page.data.pickerOptions[thinkingIndex].efforts, effort => effort.label),['Off','Low','High']);
  page.chooseModelEffort({ currentTarget: { dataset: { optionIndex: thinkingIndex, effortIndex: 2 } } });
  assert.deepEqual(calls.at(-1),['fixture','thinking','high']);
  assert.equal(page.data.modelLabel,'思考模型 · High');
  page.pickAgentPreset();
  wx.navigateBack = options => { calls.push(['creator-back', options.delta]); };
  await page.createCustomAgentPreset();
  assert.deepEqual(calls.filter(call => call[0] === 'agent-presets').at(-1), ['agent-presets']);
  assert.equal(state.pendingAgentPresetCreator.owner, 'node');
  assert.equal(state.pendingAgentPresetCreator.workspaceId, 'workspace-1');
  assert.ok(calls.some(call => call[0] === 'creator-back' && call[1] === 1));
  assert.equal(page.data.picker, '', 'the preset sheet closes before returning to Home');
  assert.equal(page.data.creatingPreset, false);
  // 工作区文件改为弹窗浏览，不再跳转页面
  page.openFiles(); assert.equal(page.data.filesSheet,true);
  assert.equal(calls.filter(c => c[0] === 'navigate').length,0);
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
  for(const match of read('pages/session-settings/session-settings.wxml').matchAll(/catchtap="([^"]+)"/g))assert.equal(typeof page[match[1]],'function',match[1]);
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

test('conversation status style sheet has a resizable grabber and no text close action', () => {
  const html = read('pages/settings/settings.wxml');
  const css = read('pages/settings/settings.wxss');
  const statusSheet = html.match(/<view wx:if="\{\{statusStyleSheetOpen\}\}"[\s\S]*?status-style-footer[\s\S]*?<\/view>\s*<\/view>\s*<\/view>/);
  assert.ok(statusSheet, 'status style sheet exists');
  assert.match(statusSheet[0], /class="sheet-grabber-zone" data-sheet="statusStyle"[^>]*sheetGrabStart[^>]*sheetGrabMove[^>]*sheetGrabEnd/);
  assert.match(statusSheet[0], /sheetExpanded\.statusStyle \? 90 : 90/);
  assert.doesNotMatch(statusSheet[0], /status-style-close|\{\{ui\['完成'\]\}\}/);
  assert.match(css, /\.status-style-sheet\.resizable\s*\{[^}]*transition:height/);
  assert.match(css, /\.status-style-list\s*\{[^}]*flex:1/);
  // The status-strip preview uses the same DSH whale asset as the live conversation row.
  assert.match(statusSheet[0], /<canvas type="2d" id="statusPreviewCanvas-\{\{item\.id\}\}" class="status-tail-canvas" style="width:28rpx;height:28rpx;">/);
  assert.doesNotMatch(statusSheet[0], /statusIconFile/);
});

test('execution icon row follows the status style row and mirrors its resizable sheet', () => {
  const html = read('pages/settings/settings.wxml');
  const js = read('pages/settings/settings.js');
  const css = read('pages/settings/settings.wxss');
  const styleIndex = html.indexOf('bindtap="openStatusStyles"');
  const iconIndex = html.indexOf('bindtap="openProcIcons"');
  const styleLabel = html.indexOf('>对话状态条</text>');
  const iconLabel = html.indexOf('>执行图标</text>');
  assert.ok(styleIndex >= 0 && iconIndex > styleIndex && iconLabel > iconIndex, 'execution icon row follows the status style row');
  assert.ok(styleLabel > styleIndex && styleLabel < iconIndex, 'status style row keeps its label');
  assert.ok(!html.slice(styleIndex, iconLabel).includes('group-title'), 'both rows share the Appearance group');
  assert.match(html.slice(styleIndex, iconLabel), /bindtap="openProcIcons"/);
  const sheet = html.match(/<view wx:if="\{\{procIconSheetOpen\}\}"[\s\S]*?status-style-footer[\s\S]*?<\/view>\s*<\/view>\s*<\/view>/);
  assert.ok(sheet, 'execution icon sheet exists');
  assert.match(sheet[0], /class="sheet-grabber-zone" data-sheet="procIcon"[^>]*sheetGrabStart[^>]*sheetGrabMove[^>]*sheetGrabEnd/);
  assert.match(sheet[0], /sheetExpanded\.procIcon \? 90 : 90/);
  assert.match(sheet[0], /wx:for="\{\{procIconChoices\}\}"/);
  assert.match(sheet[0], /class="proc-loader proc-look-\{\{item\.id\}\}"/);
  assert.match(sheet[0], /template is="procIconGlyph" data="\{\{styleId: item\.id\}\}"/);
  assert.doesNotMatch(sheet[0], /\.gif|item\.file/);
  assert.match(sheet[0], /正在执行命令/);
  assert.match(sheet[0], /bindtap="chooseProcIcon"/);
  assert.match(sheet[0], /图标动效保存在当前小程序 · 自动保存/);
  assert.doesNotMatch(sheet[0], /status-style-close|\{\{ui\['完成'\]\}\}/);
  for (const handler of ['openProcIcons', 'closeProcIcons', 'chooseProcIcon']) assert.match(js, new RegExp(handler + '\\('), handler);
  assert.match(js, /procIconStyle\.save\(/);
  // The loader styles are shared by the session head and the picker previews.
  const procCss = read('styles/proc-icon.wxss');
  assert.match(procCss, /\.proc-loader\s*\{[^}]*width:\s*32rpx[^}]*height:\s*32rpx/);
  assert.match(procCss, /\.proc-loader\.proc-look-cells\s*\{[^}]*border-radius:\s*8rpx/);
  assert.match(procCss, /@keyframes procCellBlink/);
  for (const animation of ['procTerraSpin', 'procMorphShape', 'procGridPulse', 'procOrbitSpin', 'procRipple', 'procWave']) assert.match(procCss, new RegExp('@keyframes ' + animation));
  assert.doesNotMatch(read('pages/session/session.wxss'), /@keyframes procCellBlink/, 'loader keyframes live in the shared stylesheet');
  assert.match(read('pages/session/session.wxss'), /@import "\.\.\/\.\.\/styles\/proc-icon\.wxss"/);
  assert.match(css, /@import "\.\.\/\.\.\/styles\/proc-icon\.wxss"/);
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

test('default preset and model sheets retain the bottom modal and use dsh-mobile style cards', () => {
  const html = read('pages/session-settings/session-settings.wxml');
  const css = read('pages/session-settings/session-settings.wxss');
  assert.match(html, /class="pair-sheet-mask"[\s\S]*?class="pair-sheet resizable/);
  assert.match(html, /class="preset-option-card[\s\S]*?preset-card-description/);
  assert.match(html, /class="picker-current-badge"/);
  assert.match(html, /class="picker-provider-title"/);
  assert.match(html, /class="model-option-card[\s\S]*?class="model-effort-chip/);
  assert.match(html, />\{\{effort\.label\}\}<\/view>/);
  assert.match(html, /picker === 'permission'[\s\S]*?permission-card-icon/);
  assert.match(html, /permission-card-icon" src="\/assets\/icons\/\{\{item.icon\}\}"/);
  assert.match(html, /model-option-main" data-index="\{\{optionIndex\}\}"/);
  assert.match(css, /\.preset-option-card\.selected/);
  assert.match(css, /\.preset-option-card\.selected,[\s\S]*?border:\s*1rpx solid var\(--text\)/);
  assert.match(css, /\.picker-option-list\.permission-picker-list/);
  assert.match(css, /\.preset-card-name,[\s\S]*?font-weight:\s*600/);
  assert.match(css, /\.model-effort-chip\.selected/);
  assert.match(css, /\.picker-option-list\.model-picker-list/);
});

// 两个设置页顶部的账号区：余额卡必须点上面的身份卡才展开，且仅已登录有效。
for (const [name, wxml, js] of [
  ['settings', 'pages/settings/settings.wxml', 'pages/settings/settings.js'],
  ['session-settings', 'pages/session-settings/session-settings.wxml', 'pages/session-settings/session-settings.js']
]) {
  test(name + ': the balance card stays collapsed until the identity card is tapped', () => {
    const view = read(wxml);
    const code = read(js);
    assert.match(view, /dsh-account-card \{\{dshAccount\.signedIn \? 'tappable has-chevron' : ''\}\}" bindtap="toggleDshBalance"[\s\S]{0,120}aria-expanded="\{\{dshBalanceExpanded\}\}"/);
    // 余额卡同时要求"已点开"和"已登录"
    assert.match(view, /<view wx:if="\{\{dshBalanceExpanded && dshAccount\.signedIn\}\}" class="dsh-balance-card">/);
    // 已登录才给展开箭头，未登录连可点暗示都没有
    assert.match(view, /wx:if="\{\{dshAccount\.signedIn\}\}" class="dsh-account-chevron/);
    // 登录按钮不能冒泡到身份卡，否则未登录点一下也会展开
    assert.doesNotMatch(view, /bindtap="explainDshAccountSignIn"/);
    assert.match(code, /toggleDshBalance\(\)\s*\{\s*if \(!this\.data\.dshAccount \|\| this\.data\.dshAccount\.signedIn !== true\) return;/);
    assert.match(code, /dshBalanceExpanded: false/);
    assert.match(code, /dshAccountVisible: false, dshAccount: accountView\.normalize\(\{\}\), dshBalanceExpanded: false/);
  });
}
