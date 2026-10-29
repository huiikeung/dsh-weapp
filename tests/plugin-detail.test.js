const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildCatalog } = require('../miniprogram/utils/plugins');
const { artworkFor, imageSource } = require('../miniprogram/pages/plugin-detail/plugin-artwork');
const pluginListArtwork = require('../miniprogram/pages/plugins/plugin-artwork');
const root = path.resolve(__dirname, '..', 'miniprogram');
const name = '@deepseek-ai/dsh-experimental-session-titles-bundle';
function fixture() {
  let definition; const calls = [];
  const source = { managementAvailable: true, bundles: [{ name, optional: true, official: true, enabled: true, version: '0.2.1-rc.2', rows: [{ rowId: 'optional-session-title-all-prompts', moduleName: '@deepseek-ai/dsh-session-title-all-prompts-llm', entryId: 'entry-title' }] }], plugins: [{ entryId: 'entry-title', enabled: true, fiberPhase: 'active', description: 'All-user-messages LLM provider' }] };
  const store = { state: { connection: 'connected', pluginCatalog: buildCatalog(source) }, setPluginEnabled: (...args) => calls.push(args) };
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/plugin-detail/plugin-detail.js'),'utf8'), { Page: value => { definition = value; }, Set, wx: {}, require: id => id.endsWith('/store') ? store : require(path.resolve(root,'pages/plugin-detail',id)) });
  const page = { ...definition, data: { ...definition.data }, bundleName: name, brokenIcons: new Set(), setData(patch) { Object.assign(this.data, patch); } };
  page.syncFromStore(); return { page, store, calls };
}
test('detail header has one back link and no decorative right circle', () => {
  const xml = fs.readFileSync(path.join(root,'pages/plugin-detail/plugin-detail.wxml'),'utf8');
  const header = xml.slice(xml.indexOf('class="pdetail-header"'),xml.indexOf('<scroll-view'));
  assert.equal((header.match(/class="pdetail-back(?:\s|"︎)/g) || []).length, 1);
  assert.ok(header.includes('bindtap="goBack"'));
  assert.ok(!header.includes('<view class="pdetail-back"></view>'));
  assert.ok(!xml.includes('icon-fallback'));
  for (const text of ['来源信息', '代码来源', 'bundle.experimental', 'item.description', 'item.id']) assert.ok(xml.includes(text));
});
test('original desktop icon is shared by list and detail; component fallback matches desktop', () => {
  assert.equal(artworkFor(name), '/assets/plugin-artwork/desktop/dsh-experimental-session-titles-bundle.svg');
  assert.ok(fs.readFileSync(path.join(root,artworkFor(name).slice(1)),'utf8').includes('session-title-bubble'));
  assert.equal(artworkFor('',true), '/assets/plugin-artwork/desktop/plugin-default.svg');
  for (const icon of [artworkFor(name), artworkFor('',true), pluginListArtwork.artworkFor(name), pluginListArtwork.artworkFor('',true)]) {
    assert.ok(fs.existsSync(path.join(root, icon.slice(1))), 'missing artwork: ' + icon);
  }
  // 内置四项与未知插件都改用 DSH 客户端同款彩色图标（列表与详情共用同一套映射）
  assert.equal(pluginListArtwork.artworkFor('shell'), '/assets/plugin-artwork/desktop/dsh-experimental-terminal-bundle.svg');
  assert.equal(pluginListArtwork.artworkFor('subagent'), '/assets/plugin-artwork/desktop/dsh-subagent-codex.svg');
  assert.equal(pluginListArtwork.artworkFor('web-search'), '/assets/plugin-artwork/desktop/dsh-experimental-session-search.svg');
  assert.equal(pluginListArtwork.artworkFor('agent-loop'), '/assets/plugin-artwork/desktop/dsh-experimental-ralph-bundle.svg');
  assert.equal(pluginListArtwork.artworkFor('unlisted-plugin'), '/assets/plugin-artwork/desktop/plugin-default.svg');
  assert.equal(artworkFor('unlisted-plugin'), pluginListArtwork.artworkFor('unlisted-plugin'));
  assert.equal(imageSource('./icon.svg'), null); assert.equal(imageSource('javascript:alert(1)'), null);
  assert.equal(imageSource('https://example.com/icon.svg'), 'https://example.com/icon.svg');
});
test('component count, module title, source and live state reflect gateway data', () => {
  const { page, store } = fixture();
  assert.equal(page.data.bundle.activeCount, 1); assert.equal(page.data.bundle.experimental, true);
  assert.equal(page.data.bundle.sourceLabel, '内置');
  assert.equal(page.data.bundle.entries[0].name, '@deepseek-ai/dsh-session-title-all-prompts-llm');
  assert.equal(page.data.bundle.entries[0].phase, 'active');
  assert.equal(page.data.bundle.entries[0].description, 'All-user-messages LLM provider');
  page.openEntry({ currentTarget: { dataset: { index: 0 } } });
  store.state.pluginCatalog.source.plugins[0].fiberPhase = 'failed'; page.syncFromStore();
  assert.equal(page.data.bundle.activeCount, 0); assert.equal(page.data.sheetEntry.phase, 'failed');
});
test('failed icons fall back and disabled component switches cannot mutate state', () => {
  const { page, store, calls } = fixture();
  store.state.pluginCatalog.source.bundles[0].meta = { icon: 'https://example.com/broken.svg' }; page.syncFromStore();
  page.onIconError({ currentTarget: { dataset: { src: 'https://example.com/broken.svg' } } });
  assert.equal(page.data.bundle.iconBroken, true);
  store.state.connection = 'disconnected'; page.syncFromStore();
  page.onEntryToggle({ detail: { value: false }, currentTarget: { dataset: { entry: 'entry-title' } } });
  assert.equal(calls.length, 0);
});
test('voice detail cold entry refreshes catalog without requiring the plugin list', () => {
  const { page, store, calls } = fixture();
  store.refreshPlugins = () => { calls.push('catalog'); store.state.pluginsLoading = true; };
  store.state.pluginCatalog = null;
  page.onShow(); page.onShow(); assert.deepEqual(calls, ['catalog']);
  store.state.pluginsLoading = false;
  store.state.pluginCatalog = { bundles: [] }; page.onShow();
  assert.deepEqual(calls, ['catalog']);
  const route = require('../miniprogram/pages/session/utils/voice-preference').SETTINGS_URL;
  const bundle = decodeURIComponent(route.split('bundle=')[1]);
  assert.equal(require('../miniprogram/pages/plugin-detail/plugin-settings').kindFor(null, bundle), 'voice');
});

test('subagent bundle detail exposes update and uninstall actions', () => {
  const root = path.resolve(__dirname, '..');
  const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/plugin-detail/plugin-detail.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'miniprogram/pages/plugin-detail/plugin-detail.js'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'miniprogram/pages/plugin-detail/plugin-detail.wxss'), 'utf8');
  const gateway = fs.readFileSync(path.join(root, 'miniprogram/utils/gateway.js'), 'utf8');
  // 顶部操作：有新版显示更新，已安装显示卸载，点击分别走到安装目标升级 / 主机卸载
  assert.ok(wxml.includes('pdetail-action pdetail-action-update'));
  assert.ok(wxml.includes('bindtap="onUpdateBundle"'));
  assert.ok(wxml.includes('pdetail-action pdetail-action-danger'));
  assert.ok(wxml.indexOf('pdetail-action-update') < wxml.indexOf('dsh-switch checked="{{bundle.enabled}}"'), 'actions sit left of the enable switch');
  assert.ok(wxml.includes('bindtap="onUninstallBundle"'));
  assert.ok(wxml.includes('class="pdetail-sheet-mask"') && wxml.includes('wx:if="{{uninstallOpen}}"'), 'uninstall uses a bottom sheet');
  assert.ok(wxml.includes('bindtap="confirmUninstall"'));
  assert.ok(wxml.includes("ui['更新']") && wxml.includes("ui['卸载']"));
  // 标题行徽标
  assert.ok(wxml.includes('pdetail-badge-error'));
  assert.ok(wxml.includes('pdetail-badge-update'));
  // 行为：更新转交插件列表的官方安装流程；卸载二次确认后调用网关并刷新目录
  assert.match(js, /onUpdateBundle\(\)[\s\S]{0,240}?pendingOfficialInstall = bundle\.name/);
  assert.match(js, /onUninstallBundle\(\)[\s\S]{0,240}?uninstallOpen: true/);
  assert.match(js, /confirmUninstall\(\)[\s\S]{0,240}?uninstallBundle\(\)/);
  assert.match(js, /uninstallBundle\(\)[\s\S]{0,320}?requestPluginUninstall\(name\)/);
  assert.match(js, /requestPluginUninstall\(name\)[\s\S]{0,260}?store\.refreshPlugins\(\)/);
  assert.match(gateway, /requestPluginUninstall\(name\) \{[\s\S]{0,120}?plugin-uninstall/);
  // 数据字段来自目录
  assert.match(js, /updateAvailable: !!bundle\.updateAvailable/);
  assert.match(js, /canUninstall: bundle\.installed === true/);
  // 样式：更新为中性按钮，卸载为红色文字按钮
  assert.match(wxss, /\.pdetail-action-danger \{[^}]*#FF5A52/);
  assert.match(wxss, /\.pdetail-badge-update \{[^}]*#7E9AF2/);
  assert.match(wxss, /\.pdetail-action \{[^}]*height: 40rpx/);
  assert.match(wxss, /\.pdetail-action \{[^}]*font-size: 20rpx/);
});
