'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../ascf/ascf_src');

function load(relative, options = {}) {
  const filename = path.join(root, relative);
  const module = { exports: {} };
  const context = {
    module, exports: module.exports, console, setTimeout, clearTimeout,
    require(name) {
      if (Object.prototype.hasOwnProperty.call(options.imports || {}, name)) return options.imports[name];
      throw new Error('Unexpected import: ' + name);
    },
    ...options.globals
  };
  if (Object.prototype.hasOwnProperty.call(options, 'has')) context.has = options.has;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return module.exports;
}

function storage() {
  const data = new Map();
  return { data, api: {
    getStorageSync: key => data.get(key),
    setStorageSync: (key, value) => data.set(key, value),
    removeStorageSync: key => data.delete(key)
  } };
}

test('local cache uses has by default, preserves injection and handles missing globals', () => {
  const first = storage(), injected = storage();
  const cacheModule = load('utils/local-cache.js', { has: first.api });
  const a = cacheModule.createLocalCache({ prefix: 'default' });
  a.set('item', { value: 7 }, { immediate: true });
  assert.equal(JSON.parse(first.data.get('default.item')).value.value, 7);
  const b = cacheModule.createLocalCache({ prefix: 'override', storage: injected.api });
  b.set('item', 8, { immediate: true });
  assert.equal(JSON.parse(injected.data.get('override.item')).value, 8);
  assert.equal(first.data.has('override.item'), false);
  const noGlobal = load('utils/local-cache.js').createLocalCache({ prefix: 'memory' });
  noGlobal.set('item', 9, { immediate: true });
  assert.equal(noGlobal.get('item'), 9);
});

test('attachment cache and storage usage resolve has without wx', () => {
  const files = new Set(['/data/dsh-attachment-cache/picture.png']);
  const disk = { accessSync(p) { if (!files.has(p)) throw Error('missing'); },
    readdirSync(p) { return p === '/data/dsh-attachment-cache' ? ['picture.png'] : []; },
    statSync() { return { size: 12 }; } };
  const api = { env: { USER_DATA_PATH: '/data' }, getFileSystemManager: () => disk,
    getStorageInfoSync: () => ({ keys: ['dsh_session_cache.a'], currentSize: 1, limitSize: 10 }),
    getStorageSync: () => 'cached' };
  const cache = load('utils/attachment-cache.js', { has: api, imports: { './ui-preferences': { t: x => x } } });
  assert.equal(cache.localPath({ attachmentId: 'picture', mediaType: 'image/png' }), '/data/dsh-attachment-cache/picture.png');
  const usage = load('pages/settings/utils/storage-usage.js', { has: api }).collect();
  assert.equal(usage.totalBytes, 18);
  assert.equal(usage.storageText, '1 KB / 10 KB');
  const missing = load('utils/attachment-cache.js', { imports: { './ui-preferences': { t: x => x } } });
  assert.equal(missing.localPath({ attachmentId: 'missing' }), '');
});

test('file downloads and cleanup use the has filesystem by default', async () => {
  const operations = [];
  const fsApi = {
    writeFile: args => { operations.push(['write', args.filePath]); args.success({}); },
    rename: args => { operations.push(['rename', args.newPath]); args.success({}); },
    unlink: args => { operations.push(['unlink', args.filePath]); args.success({}); }
  };
  const api = { env: { USER_DATA_PATH: '/data' }, getFileSystemManager: () => fsApi,
    base64ToArrayBuffer: value => Uint8Array.from(Buffer.from(value, 'base64')).buffer };
  const downloads = load('pages/session/utils/file-download.js', { has: api, imports: {
    '../../../utils/ui-preferences': { t: x => x },
    './file-deliverables': { relativePath: value => value },
    './file-sha256': class { update() {} hex() { return 'digest'; } }
  } });
  const client = { connectGeneration: 1,
    openFileDownload: async () => ({ transferId: 't', sessionId: 's', path: 'file', size: 0, chunkBytes: 8 }),
    readFileDownload: async () => ({ transferId: 't', offset: 0, data: '', eof: true, sha256: 'digest' }) };
  const result = await downloads.downloadFile(client, { sessionId: 's', path: 'file' });
  assert.match(result.localPath, /^\/data\/dsh-file-/);
  assert.deepEqual(operations.map(x => x[0]), ['write', 'rename']);
  await downloads.removeFile(result.localPath);
  assert.equal(operations.at(-1)[0], 'unlink');
});

test('voice actions inject has into the existing wx-named controller parameter', () => {
  const VoiceInput = load('pages/session/utils/voice-input.js').VoiceInput;
  const recorder = {};
  const api = { getRecorderManager: () => recorder };
  const actions = load('pages/session/voice-actions.js', { has: api, imports: {
    '../../utils/ui-preferences': { t: x => x }, './utils/voice-preference': {},
    './utils/voice-input': { VoiceInput }, '../../utils/store': { client: {} }, './utils/composer-menu': {}
  } });
  const controller = actions.voiceController.call({});
  assert.equal(controller.wx, api);
  controller.ensureRecorder();
  assert.equal(controller.recorder, recorder);
});

test('image preview, file share and switch listeners use has and tolerate absent globals', () => {
  const previews = [], listeners = [];
  const api = { previewImage: value => previews.push(value), shareFileMessage() {},
    onThemeChange: fn => listeners.push(fn), offThemeChange: fn => listeners.push(fn) };
  const imageImports = { '../../utils/store': {}, './utils/file-download': {} };
  const images = load('pages/session/image-blocks.js', { has: api, imports: imageImports });
  const page = { data: { rows: [{ key: 'row', blocks: [{ type: 'image', src: 'https://example.test/p.png' }] }] } };
  images.previewMarkdownImage.call(page, { currentTarget: { dataset: { src: 'https://example.test/p.png', key: 'row' } } });
  assert.equal(previews.length, 1);
  assert.equal(previews[0].current, 'https://example.test/p.png');
  load('pages/session/image-blocks.js', { imports: imageImports }).previewMarkdownImage.call(page, { currentTarget: { dataset: { src: 'x' } } });
  const fileImports = { '../../utils/store': {}, '../../utils/ui-preferences': {}, './utils/file-deliverables': {}, './utils/file-preview': {}, './utils/file-download': {} };
  assert.equal(load('pages/session/file-actions.js', { has: api, imports: fileImports }).canShareFiles(), true);
  assert.equal(load('pages/session/file-actions.js', { imports: fileImports }).canShareFiles(), false);
  let component;
  load('components/dsh-switch/dsh-switch.js', { has: api, imports: { '../../utils/theme': {} }, globals: { Component: value => { component = value; } } });
  const instance = { syncTheme() {} };
  component.lifetimes.attached.call(instance);
  component.lifetimes.detached.call(instance);
  assert.equal(listeners.length, 2);
  assert.equal(listeners[0], listeners[1]);
});

test('UI copy wrappers are installed on has without wx', () => {
  let shown;
  const api = { getStorageSync: key => key === 'appLanguage' ? 'en' : undefined,
    showToast: options => { shown = options; } };
  const imports = {};
  for (const part of ['trajectory', 'interface', 'voice', 'files', 'collaboration', 'process']) imports['../i18n/' + part] = {};
  imports['../i18n/interface'] = { '确认': 'Confirm' };
  const prefs = load('utils/ui-preferences.js', { has: api, imports, globals: { Page() {} } });
  prefs.install();
  api.showToast({ title: '确认' });
  assert.equal(shown.title, 'Confirm');
});

test('session page passes has to attachment lookups and selector queries', () => {
  const filename = path.join(root, 'pages/session/session.js');
  const api = { getStorageSync() {}, createSelectorQuery() { throw new Error('query reached'); } };
  const store = { state: { sessions: [] }, sessionState: { sessionId: 's' }, client: {} };
  let definition, received;
  const previous = global.has;
  global.has = api;
  try {
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      has: api, Page: value => { definition = value; }, console, setTimeout, clearTimeout, setInterval, clearInterval,
      require(name) {
        if (name.endsWith('/store')) return store;
        if (name.endsWith('/attachment-cache')) return { localPath: (image, options) => { received = options.api; return '/cached.png'; } };
        return require(path.resolve(path.dirname(filename), name));
      }
    }, { filename });
    const result = definition.decorateRowImages([{ attachmentId: 'picture' }]);
    assert.equal(received, api);
    assert.equal(result[0].localUrl, '/cached.png');
    const page = { data: { tab: 'context', showContextPanel: true, contextPanel: { trend: { overview: true } } } };
    assert.throws(() => definition.measureContextTrendPane.call(page), /query reached/);
  } finally {
    if (previous === undefined) delete global.has; else global.has = previous;
  }
});

test('page JSON uses concrete light theme defaults', () => {
  const light = JSON.parse(fs.readFileSync(path.join(root, 'theme.json'), 'utf8')).light;
  const expected = {
    'session/session.json': { navigationBarTextStyle: light.navTxtStyle },
    'home/home.json': { navigationBarBackgroundColor: light.homeNavBgColor },
    'workspace-picker/workspace-picker.json': { navigationBarBackgroundColor: light.navBgColor, navigationBarTextStyle: light.navTxtStyle, backgroundColor: light.bgColor },
    'files/files.json': { navigationBarBackgroundColor: light.navBgColor, navigationBarTextStyle: light.navTxtStyle, backgroundColor: light.bgColor },
    'cost-meter/cost-meter.json': { navigationBarBackgroundColor: light.navBgColor, navigationBarTextStyle: light.navTxtStyle, backgroundColor: light.bgColor },
    'session-settings/session-settings.json': { navigationBarBackgroundColor: light.navBgColor, navigationBarTextStyle: light.navTxtStyle, backgroundColor: light.bgColor }
  };
  for (const name of ['plugins/plugins', 'settings/settings', 'add-node/add-node', 'plugin-detail/plugin-detail', 'schedule/schedule', 'privacy/privacy']) {
    expected[name + '.json'] = { backgroundColor: light.bgColor };
  }
  for (const [file, values] of Object.entries(expected)) {
    const data = JSON.parse(fs.readFileSync(path.join(root, 'pages', file), 'utf8'));
    for (const [key, value] of Object.entries(values)) assert.equal(data[key], value, file + ':' + key);
  }
  for (const directory of fs.readdirSync(path.join(root, 'pages'), { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const pageDir = path.join(root, 'pages', directory.name);
    for (const name of fs.readdirSync(pageDir)) {
      if (!name.endsWith('.json')) continue;
      const text = fs.readFileSync(path.join(pageDir, name), 'utf8');
      JSON.parse(text);
      assert.doesNotMatch(text, /"@(?:navBgColor|homeNavBgColor|navTxtStyle|bgColor)"/, directory.name + '/' + name);
    }
  }
});

test('scoped source has no remaining unbound wx guard or API argument', () => {
  const files = [];
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.name.endsWith('.js')) files.push(full);
    }
  }
  walk(path.join(root, 'pages'));
  walk(path.join(root, 'components/dsh-switch'));
  for (const name of ['local-cache.js', 'ui-preferences.js', 'attachment-cache.js', 'store.js']) files.push(path.join(root, 'utils', name));
  const unresolved = /\btypeof\s+wx\s*(?:===|!==|==|!=)|\bapi\s*:\s*wx\b|\b(?:return|\|\||=)\s*wx\b|!wx\b|new VoiceInput\(\{\s*wx\s*,/;
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!line.trimStart().startsWith('//')) assert.doesNotMatch(line, unresolved, path.relative(root, file) + ':' + (index + 1));
    });
  }
});
