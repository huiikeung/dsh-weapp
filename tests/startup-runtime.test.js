const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'miniprogram');
// Match WeChat's JS-only module registry instead of Node's JSON require extension.
function boot(options = {}) {
  const modules = new Map(), pages = [], storage = { appLanguage: options.language || 'zh' };
  let app;
  const context = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval,
    Page: options => pages.push(options), App: options => { app = options; },
    wx: { getStorageSync: key => storage[key], getAppBaseInfo: () => ({ language: 'zh_CN' }) }
  });
  function load(file) {
    file = path.resolve(file);
    if (modules.has(file)) return modules.get(file).exports;
    assert.ok(file.endsWith('.js'), 'WeChat runtime cannot require config JSON: ' + file);
    assert.ok(fs.existsSync(file), 'Runtime module missing: ' + file);
    const module = { exports: {} }; modules.set(file, module);
    const requireLocal = name => {
      if (name === 'crypto' && file.endsWith('nacl.min.js')) return {}; // Node fallback is unused during registration.
      assert.ok(name.startsWith('.'), 'Unexpected external module: ' + name);
      return load(path.resolve(path.dirname(file), name.endsWith('.js') || name.endsWith('.json') ? name : name + '.js'));
    };
    const wrapper = vm.runInContext('(function(require,module,exports){\n' + fs.readFileSync(file,'utf8') + '\n})', context, { filename: file });
    wrapper(requireLocal, module, module.exports);
    return module.exports;
  }
  if (options.withoutFromEntries) vm.runInContext('Object.fromEntries = undefined', context);
  load(path.join(root, 'app.js'));
  return { context, pages, load, app: () => app };
}
test('app and every page register with the WeChat JS-only module loader', () => {
  const runtime = boot();
  assert.equal(typeof runtime.app().onLaunch, 'function');
  const routes = require('./helpers/routes.cjs')(JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8')));
  for (const route of routes) runtime.load(path.join(root, route + '.js'));
  assert.equal(runtime.pages.length, routes.length);
  for (const page of runtime.pages) {
    assert.equal(page.data.ui['设置'], '设置');
    assert.equal(page.data.fontSizes.text, 14);
  }
});
test('preference registration remains available without Object.fromEntries', () => {
  const runtime = boot({ withoutFromEntries: true });
  runtime.load(path.join(root, 'pages/home/home.js'));
  assert.equal(runtime.pages.length, 1);
  assert.equal(runtime.pages[0].data.ui['设置'], '设置');
});

test('runtime dictionaries stay aligned with their source JSON', () => {
  for (const name of ['trajectory', 'interface']) {
    const source = JSON.parse(fs.readFileSync(path.join(root, '..', 'resources/i18n', name + '.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.deepEqual(require('../miniprogram/i18n/' + name), source);
  }
});

test('all pages register in English with the JS-only WeChat loader', () => {
  const runtime = boot({ language: 'en' });
  const routes = require('./helpers/routes.cjs')(JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')));
  for (const route of routes) runtime.load(path.join(root, route + '.js'));
  for (const page of runtime.pages) {
    assert.equal(page.data.uiLocale, 'en');
    assert.equal(page.data.ui['设置'], 'Settings');
    assert.equal(page.data.ui['工作区文件'], 'Workspace files');
    assert.equal(page.data.ui['正在加载自动化任务…'], 'Loading automations…');
  }
  assert.equal(runtime.pages[0].data.connectionLabel, 'Disconnected');
});
