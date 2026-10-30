const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const browse = require('../miniprogram/utils/directory-browse');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', file), 'utf8');

test('crumb trail labels the computer root and the host home', () => {
  const trail = browse.directoryCrumbTrail([
    { name: '/', path: '/' },
    { name: 'Users', path: '/Users' },
    { name: 'me', path: '/Users/me' }
  ], { root: '电脑', home: '主目录' }, '/Users/me');
  assert.deepEqual(trail.map(item => item.label), ['电脑', 'Users', '主目录']);
  assert.deepEqual(trail.map(item => item.current), [false, false, true]);
  assert.equal(trail[0].path, '/');
});

test('windows drive roots keep their own label and are parents of nothing', () => {
  const trail = browse.directoryCrumbTrail([
    { name: 'C:\\', path: 'C:\\' },
    { name: 'Users', path: 'C:\\Users' }
  ], { root: '电脑', home: '主目录' }, 'C:\\Users\\me');
  assert.deepEqual(trail.map(item => item.label), ['C:\\', 'Users']);
  assert.equal(browse.directoryParentPath([{ path: 'C:\\' }]), null);
  assert.equal(browse.directoryParentPath([{ path: 'C:\\' }, { path: 'C:\\Users' }]), 'C:\\');
});

test('hidden directories are filtered out until the toggle is on', () => {
  const entries = [{ name: '.dsh', hidden: true }, { name: 'Documents' }, { name: 'Downloads', hidden: false }];
  assert.deepEqual(browse.visibleDirectoryEntries(entries, false).map(item => item.name), ['Documents', 'Downloads']);
  assert.equal(browse.visibleDirectoryEntries(entries, true).length, 3);
  assert.deepEqual(browse.visibleDirectoryEntries(null, false), []);
});

test('absolute path input accepts POSIX and drive paths, expands ~, rejects relative text', () => {
  assert.deepEqual(browse.normalizeDirectoryInput('/tmp', ''), { path: '/tmp' });
  assert.deepEqual(browse.normalizeDirectoryInput('  /Users/me/Downloads/  ', ''), { path: '/Users/me/Downloads' });
  assert.deepEqual(browse.normalizeDirectoryInput('~', '/Users/me'), { path: '/Users/me' });
  assert.deepEqual(browse.normalizeDirectoryInput('~/Documents/', '/Users/me'), { path: '/Users/me/Documents' });
  assert.deepEqual(browse.normalizeDirectoryInput('D:/Games', '/Users/me'), { path: 'D:/Games' });
  assert.deepEqual(browse.normalizeDirectoryInput('D:\\Games\\', ''), { path: 'D:\\Games' });
  assert.deepEqual(browse.normalizeDirectoryInput('D:/', ''), { path: 'D:/' });
  assert.deepEqual(browse.normalizeDirectoryInput('C:\\', ''), { path: 'C:\\' });
  assert.deepEqual(browse.normalizeDirectoryInput('//nas/share', ''), { path: '//nas/share' });
  assert.deepEqual(browse.normalizeDirectoryInput('', ''), { error: 'empty' });
  assert.deepEqual(browse.normalizeDirectoryInput('  ', ''), { error: 'empty' });
  assert.deepEqual(browse.normalizeDirectoryInput('Downloads', ''), { error: 'not-absolute' });
  assert.deepEqual(browse.normalizeDirectoryInput('~', ''), { error: 'not-absolute' });
});

test('directory sheet markup carries location, breadcrumb, hidden toggle and path editor', () => {
  const markup = read('pages/home/home.wxml');
  assert.ok(markup.includes('bindtap="openDirLocations"'), 'location panel entry');
  assert.ok(markup.includes('class="dir-crumbs"'));
  assert.ok(markup.includes('bindtap="selectDirCrumb"'));
  assert.ok(markup.includes('bindtap="toggleDirHidden"'));
  assert.ok(markup.includes('bindtap="openDirJump"'));
  assert.ok(markup.includes('wx:for="{{dirVisibleEntries}}"'));
  assert.ok(markup.includes('data-path="{{item.path}}"'));
  assert.ok(markup.includes('dir-locations-sheet'), 'other drives panel');
  assert.ok(markup.includes('{{ui[\'其他盘\']}}'));
  const css = read('pages/home/home.wxss');
  assert.ok(css.includes('.dir-crumbs'));
  assert.ok(css.includes('.dir-hidden-toggle'));
  assert.ok(css.includes('.dir-location-row'));
});

const HOME = '/Users/me';

function createPage() {
  let definition;
  const requests = [];
  const storage = {};
  const toasts = [];
  const frameFor = (target) => {
    if (target === '/Volumes') {
      return { kind: 'directories', path: '/Volumes', home: HOME, crumbs: [{ name: '/', path: '/' }, { name: 'Volumes', path: '/Volumes' }], entries: [{ name: 'ExtDisk', path: '/Volumes/ExtDisk' }] };
    }
    if (target === '/mnt' || target === '/media') return Promise.reject(new Error('missing'));
    const pathValue = target || HOME;
    return {
      kind: 'directories',
      path: pathValue,
      home: HOME,
      crumbs: pathValue === HOME
        ? [{ name: '/', path: '/' }, { name: 'Users', path: '/Users' }, { name: 'me', path: HOME }]
        : [{ name: '/', path: '/' }, { name: 'Users', path: '/Users' }, { name: 'me', path: HOME }, { name: 'Documents', path: pathValue }],
      entries: [
        { name: '.cache', path: pathValue + '/.cache', hidden: true },
        { name: 'Documents', path: pathValue + '/Documents', hidden: false },
        { name: 'Downloads', path: pathValue + '/Downloads', hidden: false }
      ]
    };
  };
  const client = {
    requestDirectories(target) {
      requests.push(target);
      const result = frameFor(target);
      return result && typeof result.then === 'function' ? result : Promise.resolve(result);
    },
    requestWorkspaces() {}
  };
  const store = { state: { connection: 'connected' }, client, sessionState: {}, setCurrentWorkspace() {}, createAndOpenSession() {}, stopHostProbes() {} };
  const wx = {
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    showToast: options => toasts.push(options),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 47, safeArea: { bottom: 810 } }),
    createSelectorQuery: () => ({ in() { return this; }, select() { return this; }, boundingClientRect() { return this; }, exec() {} }),
    onThemeChange() {}, offThemeChange() {}
  };
  const stub = name => {
    if (name.endsWith('ui-preferences')) return { t: text => text, snapshot: () => ({ ui: {}, uiLocale: 'zh' }), locale: () => 'zh', subscribe: () => () => {} };
    if (name.endsWith('store')) return store;
    if (name.endsWith('haptics')) return { tick() {}, vibrate() {}, getLevel: () => 'off' };
    if (name.endsWith('theme')) return { applyTo() {}, resolveTheme: () => 'dark', onThemeChange() {} };
    if (name.endsWith('workspace-popover')) return { workspacePopoverLayout: () => ({ popLeft: 0, popTop: 0, popWidth: 200, popHeight: 90, popOriginY: 0 }) };
    if (name.endsWith('home-animation-pref')) return { enabled: () => true };
    if (name.endsWith('settings-glass-style-pref')) return { view: () => ({ glassAlphaTop: '0.04', glassAlphaBottom: '0.016', glassEdgeAlpha: '0.38', glassBlurSheet: '8', glassBlurCard: '8', glassRadiusSheet: '32', glassRadiusCard: '28', glassRadiusChoice: '18', glassBackdropBrightness: '1' }) };
    if (name.endsWith('settings-glass-pref')) return { read: () => true };
    if (name.endsWith('quota-sidebar-glass-pref')) return { read: () => false };
    if (name.endsWith('cost-view')) return { read: () => ({}) };
    if (name.endsWith('public-access-prompt')) return { maybePrompt() {} };
    if (name.endsWith('connection-status')) return { connectionView: () => ({ label: '已连接' }) };
    if (name.endsWith('session-warmup')) return { createSessionWarmup: () => ({ warm() {} }) };
    if (name.endsWith('route-table')) return { classifyEndpoint: () => 'lan' };
    if (name.endsWith('directory-browse')) return browse;
    return {};
  };
  vm.runInNewContext(read('pages/home/home.js'), {
    Page: value => { definition = value; }, wx, getApp: () => ({}), getCurrentPages: () => [], console,
    require: stub
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } };
  return { page, requests, storage, toasts };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

test('home sheet lists the host home, hides dot directories and navigates one level', async () => {
  const { page, requests } = createPage();
  page.closeWorkspacePicker = () => {};
  page.openDirSheet();
  await settle();
  assert.equal(page.data.dirSheetOpen, true);
  assert.equal(page.data.dirPath, HOME);
  assert.deepEqual(page.data.dirVisibleEntries.map(item => item.name), ['Documents', 'Downloads']);
  assert.equal(page.data.dirHiddenCount, 1);
  assert.deepEqual(page.data.dirCrumbTrail.map(item => item.label), ['电脑', 'Users', '主目录']);
  assert.equal(page.data.parentPath, '/Users');
  assert.equal(page.data.dirRootPath, '/');

  page.openDirEntry({ currentTarget: { dataset: { index: 0 } } });
  await settle();
  assert.equal(requests[requests.length - 1], HOME + '/Documents');
  assert.equal(page.data.dirPath, HOME + '/Documents');

  page.goParentDir();
  await settle();
  assert.equal(page.data.dirPath, HOME);
});

test('hidden toggle and crumb jumps work from the sheet', async () => {
  const { page, requests, storage } = createPage();
  page.closeWorkspacePicker = () => {};
  page.openDirSheet();
  await settle();
  page.toggleDirHidden();
  assert.equal(page.data.dirShowHidden, true);
  assert.equal(page.data.dirVisibleEntries.length, 3);
  assert.equal(storage.workspaceDirShowHidden, true);
  page.selectDirCrumb({ currentTarget: { dataset: { path: '/' } } });
  await settle();
  assert.equal(requests[requests.length - 1], '/');
});

test('manual absolute path accepts ~ and other-drive paths and rejects relative text', async () => {
  const { page, requests } = createPage();
  page.closeWorkspacePicker = () => {};
  page.openDirSheet();
  await settle();
  page.setData({ dirJumpValue: '~/Downloads' });
  page.submitDirJump();
  await settle();
  assert.equal(requests[requests.length - 1], HOME + '/Downloads');
  page.setData({ dirJumpValue: 'D:/Games', dirJumpError: '' });
  page.submitDirJump();
  await settle();
  assert.equal(requests[requests.length - 1], 'D:/Games');
  page.setData({ dirJumpValue: 'relative/dir' });
  page.submitDirJump();
  assert.equal(page.data.dirJumpError, '请输入以 / 或盘符开头的绝对路径');
});

test('location panel discovers mounted volumes without stealing the browse request', async () => {
  const { page } = createPage();
  page.closeWorkspacePicker = () => {};
  page.openDirSheet();
  await settle();
  page.openDirLocations();
  await settle();
  assert.equal(page.data.dirLocationsOpen, true);
  assert.equal(page.data.dirVolumes.map(item => item.name).join(','), 'ExtDisk');
  assert.equal(page.data.dirVolumesLoading, false);
  page.selectDirLocation({ currentTarget: { dataset: { path: '/Volumes/ExtDisk' } } });
  await settle();
  assert.equal(page.data.dirPath, '/Volumes/ExtDisk');
  assert.equal(page.data.dirLocationsOpen, false);
});

test('root level has no parent row and does not reload the home listing', async () => {
  const { page, requests } = createPage();
  page.closeWorkspacePicker = () => {};
  page.openDirSheet();
  await settle();
  page.applyDirFrame({
    kind: 'directories', path: '/', home: HOME,
    crumbs: [{ name: '/', path: '/' }],
    entries: [{ name: 'Users', path: '/Users' }, { name: 'Volumes', path: '/Volumes' }]
  }, '/');
  const before = requests.length;
  page.goParentDir();
  await settle();
  assert.equal(page.data.parentPath, null);
  assert.equal(requests.length, before);
});

test('windows host discovers other drive letters sequentially', async () => {
  const { page } = createPage();
  page.setData({ dirHome: 'C:\\Users\\me', dirPath: 'C:\\Users\\me' });
  page.requestDirEntries = target => target === 'D:\\'
    ? Promise.resolve([{ name: 'Games', path: 'D:\\Games' }])
    : Promise.reject(new Error('missing drive'));
  page.loadDirVolumes();
  for (let i = 0; i < 40; i++) await tick();
  assert.equal(page.data.dirVolumes.map(item => item.path).join(','), 'D:\\');
  assert.equal(page.data.dirVolumesLoading, false);
  assert.equal(page.data.dirVolumesLoaded, true);
});

test('i18n dictionary contains the new picker copy', () => {
  const dictionary = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'resources/i18n/interface.json'), 'utf8'));
  for (const key of ['主目录', '编辑路径', '显示隐藏文件', '位置', '其他盘', '前往', '没有发现其他盘']) {
    assert.ok(dictionary[key], key + ' should be translated');
  }
});
