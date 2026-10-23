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
  assert.equal(artworkFor('',true), '/assets/icons/dsh-team.svg');
  for (const icon of [artworkFor(name), artworkFor('',true), pluginListArtwork.artworkFor(name), pluginListArtwork.artworkFor('',true)]) {
    assert.ok(fs.existsSync(path.join(root, icon.slice(1))), 'missing artwork: ' + icon);
  }
  assert.equal(pluginListArtwork.artworkFor('shell'), '/assets/icons/dsh-bash.svg');
  assert.equal(pluginListArtwork.artworkFor('unlisted-plugin'), '/assets/icons/dsh-plugin.svg');
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
  const route = require('../miniprogram/utils/voice-preference').SETTINGS_URL;
  const bundle = decodeURIComponent(route.split('bundle=')[1]);
  assert.equal(require('../miniprogram/pages/plugin-detail/plugin-settings').kindFor(null, bundle), 'voice');
});
