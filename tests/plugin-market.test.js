'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { installSummary } = require('../miniprogram/utils/plugin-presentation');
const { GatewayClient } = require('../miniprogram/utils/gateway');
const bridge = require('../scripts/install-plugin-market-bridge.cjs');
function fixture() {
  const store = { state: { activeID: 'host-a' }, client: { requestPlugin(type, payload) { return new Promise((resolve, reject) => calls.push({ type, payload, resolve, reject })); } } };
  const calls = [], module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/plugins/market-actions.js'), 'utf8'), { module, require: n => n.endsWith('ui-preferences') ? require('../miniprogram/utils/ui-preferences') : store, setTimeout, clearTimeout });
  const page = { ...module.exports, alive: true, marketRead: 0, marketListingRead: 0, sourceWrite: 0, currentOwner() { return store.state.activeID; }, data: { connected: true, marketStatus: 'ready', marketSources: [], marketEntries: [], marketQuery: '', marketNext: null, marketSelected: '', sourceDraft: '', sourceSaving: false }, setData(p) { Object.assign(this.data, p); } };
  return { page, store, calls };
}
const tick = () => new Promise(r => setImmediate(r));
test('discovery empty state and source dialog match desktop bindings', () => {
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/plugins/plugins.wxml'), 'utf8');
  for (const text of ['还没有插件市场', '添加索引源', '索引源', 'https://example.com/index.json', 'sources-trust', 'bindtap="removeSource"']) assert.ok(xml.includes(text));
  const banner = xml.match(/<view wx:if="{{install}}" class="install-banner[\s\S]*?<\/view>/)[0];
  assert.ok(banner.includes('install.summary')); assert.ok(!banner.includes('install.message'));
});
test('installation summary never leaks package-manager diagnostics', () => {
  const diagnostic = 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION\nProgress: resolved 999\n'.repeat(800);
  for (const phase of ['checking', 'ready', 'installing', 'applying', 'cancelling', 'failed', 'done', 'unconfirmed', 'unknown']) {
    const value = installSummary({ phase, message: diagnostic, logs: diagnostic });
    assert.ok(value.length < 35); assert.doesNotMatch(value, /ERR_|Progress|999/);
  }
  assert.equal(installSummary({ phase: 'failed' }), '插件安装失败');
});
test('source validation refuses credentials fragments malformed URLs and duplicates', async () => {
  const { page, calls } = fixture();
  for (const input of ['file:///tmp/index.json', 'https://user:pw@example.com/i', 'https://example.com/i#', 'https://bad host/i', 'https://example.com:abc/i']) {
    page.data.sourceDraft = input; await page.addSource(); assert.match(page.data.sourceError, /http/);
  }
  page.data.marketSources = [{ url: 'https://example.com/' }];
  page.data.sourceDraft = 'HTTPS://EXAMPLE.COM:443'; await page.addSource(); assert.match(page.data.sourceError, /已添加/);
  assert.equal(calls.length, 0);
});
test('add and remove sources persist through Host and re-read canonical list', async () => {
  const { page, calls } = fixture(); page.data.sourceDraft = 'https://example.com/index.json';
  const pending = page.addSource(); assert.equal(calls[0].type, 'plugin-market-set-indexes');
  assert.equal(calls[0].payload.urls[0], page.data.sourceDraft); assert.equal(page.data.marketSources.length, 0);
  calls[0].resolve({ result: { saved: true } }); await tick();
  calls[1].resolve({ result: [{ url: 'https://example.com/index.json', title: { zh: '测试市场' } }] }); await tick();
  assert.equal(calls[2].type, 'plugin-market-search');
  calls[2].resolve({ result: { entries: [], nextOffset: null, fetchedAt: 42, title: '测试市场' } }); await pending;
  assert.equal(page.data.marketSources[0].label, '测试市场'); assert.equal(page.data.sourceDraft, '');
  const removed = page.removeSource({ currentTarget: { dataset: { url: 'https://example.com/index.json' } } });
  assert.equal(calls[3].payload.urls.length, 0); calls[3].resolve({ result: { saved: true } }); await tick();
  calls[4].resolve({ result: [] }); await removed; assert.equal(page.data.marketSources.length, 0);
});
test('Host switch or page disposal ignores delayed source reads and writes', async () => {
  const { page, store, calls } = fixture(); const pending = page.loadMarketSources();
  store.state.activeID = 'host-b'; page.resetMarket(); calls[0].resolve({ result: [{ url: 'https://a.test/i' }] }); await pending;
  assert.equal(page.data.marketSources.length, 0);
  page.data.marketStatus = 'ready'; page.data.sourceDraft = 'https://b.test/i';
  const write = page.addSource(); page.alive = false; calls[1].resolve({ result: { saved: true } }); await write;
  assert.equal(calls.length, 2);
});
test('failed save keeps confirmed sources and blocks blind repeat', async () => {
  const { page, calls } = fixture(); page.data.sourceDraft = 'https://example.com/i';
  const pending = page.addSource(); calls[0].reject(new Error('timeout')); await pending;
  assert.equal(page.data.marketStatus, 'error'); assert.equal(page.data.marketSources.length, 0);
  await page.addSource(); assert.equal(calls.length, 1); assert.match(page.data.sourceError, /尚未确认/);
});
test('legacy unsupported-market frames reject only matching requests', async () => {
  const client = Object.create(GatewayClient.prototype); client.pendingRequests = {}; client.send = () => true;
  const first = client.requestPlugin('plugin-market-indexes', {}, 1000);
  const unrelated = client.requestPlugin('plugin-registries', { requestId: 'registry' }, 1000);
  client.resolveCorrelated({ kind: 'error', message: 'unknown message type: plugin-market-indexes' });
  await assert.rejects(first, /市场接口/); assert.ok(client.pendingRequests['plugin:registry']);
  client.resolveCorrelated({ kind: 'plugin-registries', requestId: 'registry' }); await unrelated;
});
test('gateway transformations are scoped, repeatable and fail closed', async () => {
  const adapter = '    plugins: {\n    },';
  const patched = bridge.adapter(adapter); assert.equal(bridge.adapter(patched), patched);
  assert.match(patched, /invoke\('pluginMarket', 'setIndexes', \{ urls \}\)/);
  assert.throws(() => bridge.adapter('incompatible'), /Unrecognized/);
  const skeleton = `const PLUGIN_REQUEST_TYPES = new Set([\n  'plugin-catalog',\n]);\nasync function handle(api,msg) { const type=msg.type,requestId=msg.requestId;let value;\n    if (type === 'plugin-catalog') {value={};}\nreturn value;}`;
  const output = bridge.management(skeleton); assert.equal(bridge.management(output), output);
  const context = { record: x => x && typeof x === 'object' && !Array.isArray(x), nonempty: (s,n) => typeof s === 'string' && s.trim().length > 0 && s.length <= n, badRequest: () => ({ error: true }) };
  vm.createContext(context); vm.runInContext(output, context);
  let saved; const api = { pluginMarket: { setIndexes: async urls => { saved = urls; }, listIndexes: async () => [] } };
  await context.handle(api, { type: 'plugin-market-set-indexes', requestId: 'x', urls: ['https://example.com/i'] }); assert.equal(saved[0], 'https://example.com/i');
  assert.equal((await context.handle(api, { type: 'plugin-market-set-indexes', requestId: 'x', urls: 'bad' })).error, true);
});

test('Discover hides toolbar actions and uses desktop market dropdown', () => {
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/plugins/plugins.wxml'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/plugins/plugins.wxss'), 'utf8');
  assert.match(xml, /wx:if="{{pluginTab === 'installed'}}" class="plugins-actions"/);
  assert.match(css, /\.plugins \.plugins-refresh \{[^}]*border: 1rpx solid var\(--pg-border\);[^}]*border-radius: 50%;[^}]*background: transparent/);
  assert.ok(!xml.includes('market-source-tabs'));
  for (const handler of ['toggleMarketMenu', 'closeMarketMenu', 'clearMarketQuery', 'onMarketIconError']) assert.ok(xml.includes(handler));
});
test('market menu closes on selection and clears stale title', async () => {
  const { page, calls } = fixture(); page.data.marketSources = [{ url: 'https://a.test/i', label: 'A' }, { url: 'https://b.test/i', label: 'B' }];
  page.data.marketSelected = 'https://a.test/i'; page.data.marketTitle = 'A'; page.toggleMarketMenu();
  const pending = page.selectMarket({ currentTarget: { dataset: { url: 'https://b.test/i' } } });
  assert.equal(page.data.marketMenuOpen, false); assert.equal(page.data.marketTitle, ''); assert.equal(page.data.marketSelectedLabel, 'B');
  calls[0].resolve({ result: { entries: [], title: 'B full title', nextOffset: null } }); await pending;
  assert.equal(page.data.marketSources[1].label, 'B full title');
});
test('search debounces and pending query is cancelled by lifecycle reset', async () => {
  const { page, calls } = fixture(); page.data.marketSelected = 'https://a.test/i';
  page.editMarketQuery({ detail: { value: 'f' } }); page.editMarketQuery({ detail: { value: 'final' } });
  await new Promise(r => setTimeout(r, 290)); assert.equal(calls.length, 1); assert.equal(calls[0].payload.query.text, 'final');
  calls[0].resolve({ result: { entries: [], nextOffset: null } }); await tick();
  page.editMarketQuery({ detail: { value: 'cancelled' } }); page.resetMarket();
  await new Promise(r => setTimeout(r, 290)); assert.equal(calls.length, 1);
});
test('market cards use source icon and version metadata with per-icon fallback', async () => {
  const { page, calls } = fixture(); page.data.marketSelected = 'https://a.test/i';
  const pending = page.readMarket(false);
  calls[0].resolve({ result: { title: 'Market', entries: [{ name: 'pkg', title: 'Title', author: 'Author', icon: 'https://a.test/icon.png', versions: [{ version: '1.2.3', publishTimestamp: 1792368000, compatibility: { compatible: false } }] }], nextOffset: null } });
  await pending; assert.equal(page.data.marketEntries[0].version, '1.2.3'); assert.match(page.data.marketEntries[0].meta, /1.2.3 · Author/); assert.equal(page.data.marketEntries[0].installable, false);
  page.onMarketIconError({ currentTarget: { dataset: { name: 'pkg' } } }); assert.equal(page.data.marketEntries[0].iconBroken, true);
});

test('index categories render and filter search plus pagination on Host', async () => {
  const { page, calls } = fixture(); page.data.marketSelected = 'https://a.test/i';
  const metadata = { categories: { security: { title: { zh: '安全与权限' } }, tools: { title: '工具与能力' } } };
  const first = page.readMarket(false); calls[0].resolve({ result: { entries: [], metadata, nextOffset: null } }); await first;
  assert.equal(page.data.marketCategories.length, 2);
  const selected = page.selectMarketCategory({ currentTarget: { dataset: { category: 'security' } } });
  assert.equal(calls[1].payload.query.category, 'security'); assert.equal(calls[1].payload.query.offset, 0);
  calls[1].resolve({ result: { entries: [], metadata, nextOffset: 50, fetchedAt: 123 } }); await selected;
  const more = page.loadMoreMarket(); assert.equal(calls[2].payload.query.category, 'security'); assert.equal(calls[2].payload.query.offset, 50);
  calls[2].resolve({ result: { entries: [], metadata, nextOffset: null } }); await more;
  const all = page.selectMarketCategory({ currentTarget: { dataset: { category: '' } } });
  assert.ok(!('category' in calls[3].payload.query)); calls[3].resolve({ result: { entries: [], metadata, nextOffset: null } }); await all;
  await page.selectMarketCategory({ currentTarget: { dataset: { category: 'forged' } } }); assert.equal(calls.length, 4);
});
test('removed category falls back to All and reissues an unfiltered query', async () => {
  const { page, calls } = fixture(); page.data.marketSelected = 'https://a.test/i'; page.data.marketCategory = 'removed';
  const pending = page.readMarket(false); calls[0].resolve({ result: { entries: [], metadata: { categories: {} }, nextOffset: null } }); await tick();
  assert.equal(page.data.marketCategory, ''); assert.ok(!('category' in calls[1].payload.query));
  calls[1].resolve({ result: { entries: [], nextOffset: null } }); await pending;
});
test('category bridge forwards only validated category and upgrades previous bridge', async () => {
  const skeleton = `const PLUGIN_REQUEST_TYPES = new Set([\n  'plugin-catalog',\n]);\nasync function handle(api,msg) { const type=msg.type,requestId=msg.requestId;let value;\n    if (type === 'plugin-catalog') {value={};}\nreturn value;}`;
  const updated = bridge.management(skeleton);
  const previous = updated.replace(/      if \(query.category[^\n]+\n/, '').replace('...(query.category === undefined ? {} : { category: query.category }), ', '');
  assert.equal(bridge.management(previous), updated);
  const context = { record: x => x && typeof x === 'object' && !Array.isArray(x), nonempty: (s,n) => typeof s === 'string' && s.trim().length > 0 && s.length <= n, badRequest: () => ({ error: true }) };
  vm.createContext(context); vm.runInContext(updated, context);
  let received; const api = { pluginMarket: { search: async (url,query) => { received = query; return { entries: [] }; } } };
  const msg = { type: 'plugin-market-search', requestId: 'x', url: 'https://example.com/i', query: { offset: 0, limit: 50, sort: { kind: 'index' }, category: 'tools' } };
  await context.handle(api, msg); assert.equal(received.category, 'tools');
  msg.query.category = {}; assert.equal((await context.handle(api, msg)).error, true);
});

test('category panel folds without losing the selected filter', () => {
  const { page } = fixture(); page.data.marketCategory = 'last'; page.data.marketCategoriesExpanded = false;
  page.toggleMarketCategories(); assert.equal(page.data.marketCategoriesExpanded, true);
  page.toggleMarketCategories(); assert.equal(page.data.marketCategoriesExpanded, false); assert.equal(page.data.marketCategory, 'last');
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/plugins/plugins.wxml'), 'utf8');
  assert.ok(xml.includes('marketCategoriesExpanded || index < 7 || marketCategory === item.id'));
  assert.ok(xml.includes("marketCategoriesExpanded ? ui['收起'] : ui['展开全部']"));
  page.resetMarket(); assert.equal(page.data.marketCategoriesExpanded, false);
});
