const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram');
const entry = 'pages/plugin-detail/plugin-detail.js';
const actions = 'pages/plugin-detail/settings-actions.js';
const voice = 'pages/plugin-detail/voice-actions.js';
const archive = process.env.WECHAT_DEVTOOLS_ASAR || 'D:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar';

test('plugin configuration mixins use explicit imports for WeChat packaging', () => {
  for (const [file, dependency] of [[entry, './settings-actions'], [actions, './voice-actions']]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /\.\.\.\s*require\s*\(/);
    assert.ok(source.includes('= require(\'' + dependency + '\')'));
  }
});

function installedAnalyzer() {
  const fd = fs.openSync(archive, 'r');
  let source;
  try {
    const prefix = Buffer.alloc(16);
    fs.readSync(fd, prefix, 0, prefix.length, 0);
    const header = Buffer.alloc(prefix.readUInt32LE(12));
    fs.readSync(fd, header, 0, header.length, 16);
    let file = JSON.parse(header);
    for (const part of 'js/common/miniprogram-builder/common/code-analyse/index.js'.split('/')) file = file.files[part];
    const bytes = Buffer.alloc(file.size);
    fs.readSync(fd, bytes, 0, bytes.length, 8 + prefix.readUInt32LE(4) + Number(file.offset));
    source = bytes.toString('utf8');
  } finally { fs.closeSync(fd); }
  const module = { exports: {} };
  // Only filesystem watching and non-JS preprocessors are stubbed; the JS
  // parser and dependency walker are the installed developer tool's own code.
  const load = id => {
    if (['glob', 'lodash', 'chokidar'].includes(id)) return {};
    if (id.startsWith('less/')) return { default: class {} };
    if (id === 'fs-extra') return Object.assign({}, fs, fs.promises);
    return require(id);
  };
  vm.runInThisContext('(function(require,module,exports){' + source + '\n})', { filename: 'wechat-code-analyse.js' })(load, module, module.exports);
  return module.exports;
}

test('installed WeChat analyzer includes the complete plugin configuration dependency chain', { skip: !fs.existsSync(archive) }, async () => {
  const analyzer = installedAnalyzer();
  const helper = {
    mtime: file => fs.statSync(path.join(root, file)).mtimeMs,
    getString: async file => fs.readFileSync(path.join(root, file), 'utf8'),
    existFile: file => fs.existsSync(path.join(root, file)),
    existDir: file => fs.existsSync(path.join(root, file))
  };
  const deps = async (file, source) => analyzer.analyseSingeFile(file, source === undefined ? helper : {
    ...helper, getString: async name => name === file ? source : helper.getString(name)
  });
  const pageDeps = await deps(entry);
  assert.ok(pageDeps.some(dep => dep.path === actions));
  const actionDeps = await deps(actions);
  for (const file of [voice, 'utils/plugin-settings.js', 'utils/plugin-settings-copy.js']) {
    assert.ok(actionDeps.some(dep => dep.path === file), 'missing packaged dependency: ' + file);
  }
  for (const file of [entry, actions, voice]) {
    const source = await helper.getString(file);
    const found = new Set((await deps(file)).map(dep => dep.request));
    for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      assert.ok(found.has(match[1]), file + ' omits ' + match[1]);
    }
  }
  // Reproduce the old blank-page cause, not merely a Node-only source test.
  const oldPage = (await helper.getString(entry))
    .replace("const settingsActions = require('./settings-actions');", '')
    .replace('Page(Object.assign({}, settingsActions, {', "Page({ ...require('./settings-actions'),")
    .replace(/\}\)\);\s*$/, '});');
  assert.ok(!(await deps(entry, oldPage)).some(dep => dep.path === actions), 'fixture must reproduce the scanner omission');
  const oldActions = (await helper.getString(actions))
    .replace("const voiceActions = require('./voice-actions');", '')
    .replace('module.exports = Object.assign({}, voiceActions, {', "module.exports = { ...require('./voice-actions'),")
    .replace(/\}\);\s*$/, '};');
  assert.ok(!(await deps(actions, oldActions)).some(dep => dep.path === voice), 'nested mixin fixture must reproduce the scanner omission');
});
