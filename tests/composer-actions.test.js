const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const preferences = require('../miniprogram/utils/ui-preferences');
const menu = require('../miniprogram/pages/session/utils/composer-menu');
const command = (name, kind = 'immediate', extras = {}) => ({ id: 'command:' + name, name, description: name, source: 'host', ui: { kind, submitRequest: 'command-execute' }, ...extras });
const event = data => ({ currentTarget: { dataset: data } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(items = [command('goal', 'input'), command('compact'), command('model', 'select'), command('permission', 'select')]) {
  const file = path.resolve(__dirname, '../miniprogram/pages/session/session.js');
  let definition; const calls = [], pickers = [], reads = [];
  // file-actions 等 mixin 是经外层 require 载入的，跑在宿主 realm；把 wx 桩同时挂到
  // globalThis，弹窗主操作里的原生调用（previewImage / openDocument）才能被观测到。
  globalThis.wx = undefined;
  const groups = [{ id: 'commands', items }];
  const store = { state: { connection: 'connected', activeID: 'host1', currentWorkspaceId: 'w1' }, sessionState: { sessionId: 's1', commandGroups: groups, commandOptions: [], running: false },
    appendLocalUserRow: (...args) => calls.push(['echo', ...args]), selectModel: async (...args) => { calls.push(['model', ...args]); }, client: { connectGeneration: 1,
      requestCommands: async id => { calls.push(['commands', id]); return { groups }; },
      requestCommandOptions: async (id, name) => { calls.push(['options', id, name]); return { options: [{ id: 'one', label: 'First', selected: true }, { id: 'two', label: 'Second' }] }; },
      selectCommandOption: async (...args) => { calls.push(['select', ...args]); },
      setPermission: async (...args) => { calls.push(['permission', ...args]); },
      executeCommand: async (...args) => { calls.push(['execute', ...args]); },
      sendMessage: (...args) => { calls.push(['send', ...args]); return true; },
      queueUpdate: (...args) => calls.push(['queueUpdate', ...args]),
      requestQueue: (...args) => calls.push(['requestQueue', ...args]),
      requestFileList: async () => ({ path: '.', entries: [{ name: 'a b.js', path: 'src/a b.js', kind: 'file' }] })
    },
    beginNativeOverlay: () => {}, endNativeOverlay: () => {}, nativeOverlayActive: () => false
  };
  const wx = { hideKeyboard() {}, showToast: data => calls.push(['toast', data.title]),
    chooseMedia: options => pickers.push(options), chooseMessageFile: options => pickers.push(options),
    getImageInfo: options => options.success({ type: 'png' }), previewImage: options => calls.push(['preview', options]),
    getFileSystemManager: () => ({ readFile: options => reads.push(options) }) };
  globalThis.wx = wx;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: value => { definition = value; }, wx, console, setTimeout, clearTimeout,
    require: name => name.endsWith('/store') ? store : require(path.resolve(path.dirname(file), name)) });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let target = this.data;
      parts.slice(0, -1).forEach((part, i) => { if (target[part] == null) target[part] = /^\d+$/.test(parts[i + 1]) ? [] : {}; target = target[part]; });
      target[parts.at(-1)] = value;
    }
  }, updateDockInset() {}, prioritizeInteraction() {}, refreshBottomAnchor() {} };
  return { page, store, calls, pickers, reads, wx };
}
test('plus opens commands without inserting slash or clearing draft and attachments', async () => {
  const { page, calls } = fixture(); page.data.draft = 'unfinished'; page.data.images = [{ id: 'keep' }];
  await page.attachMenu(); assert.equal(page.data.draft, 'unfinished'); assert.equal(page.data.images[0].id, 'keep');
  assert.equal(page.data.commandMenu.type, 'catalog'); assert.ok(calls.some(x => x[0] === 'commands'));
  page.attachMenu(); assert.equal(page.data.commandMenu, null); assert.equal(page.data.draft, 'unfinished');
});
test('every attachment source sits on the plus first level and opens directly, without a sub-page', async () => {
  const { page, pickers } = fixture(); await page.attachMenu();
  const rows = page.data.commandMenu.groups.flatMap(group => group.items);
  assert.deepEqual(rows.slice(0, 4).map(item => [item.name, item.action]), [['image', 'image'], ['chatImage', 'chatImage'], ['workspace', 'workspace'], ['chatFile', 'chatFile']]);
  assert.deepEqual(rows.slice(0, 4).map(item => item.label), ['添加图片', '聊天中的图片', '工作区文件', '聊天中的文件']);

  page.selectCommand(event({ id: 'local:image', name: 'image', action: 'image' }));
  assert.equal(pickers.length, 1); assert.equal(page.data.commandMenu, null);
  pickers[0].fail({ errMsg: 'chooseMedia:fail cancel' });

  await page.attachMenu();
  page.selectCommand(event({ id: 'local:chat-image', name: 'chatImage', action: 'chatImage' }));
  assert.equal(pickers.length, 2); assert.equal(pickers[1].type, 'image'); assert.equal(page.data.commandMenu, null);
  pickers[1].fail({ errMsg: 'chooseMessageFile:fail cancel' });

  await page.attachMenu();
  page.selectCommand(event({ id: 'local:workspace', name: 'workspace', action: 'workspace' }));
  assert.equal(page.data.filesSheetOpen, true); assert.equal(page.data.commandMenu, null);

  await page.attachMenu();
  page.selectCommand(event({ id: 'local:chat-file', name: 'chatFile', action: 'chatFile' }));
  assert.equal(pickers.length, 3); assert.equal(pickers[2].type, 'file'); assert.equal(page.data.commandMenu, null);
  pickers[2].fail({ errMsg: 'chooseMessageFile:fail cancel' });
});

test('large images are compressed before the 8MB gate instead of being rejected by picker metadata', async () => {
  const { page, pickers, wx } = fixture();
  let compressions = 0;
  wx.compressImage = options => {
    compressions++;
    options.success({ tempFilePath: '/tmp/compressed.jpg' });
  };
  wx.getFileInfo = options => options.success({ size: options.filePath === '/tmp/original.jpg' ? 10 * 1024 * 1024 : 7 * 1024 * 1024 });
  await page.attachMenu();
  page.selectCommand(event({ id: 'local:image', name: 'image', action: 'image' }));
  await pickers[0].success({ tempFiles: [{ path: '/tmp/original.jpg', name: 'original.jpg' }] });
  assert.ok(compressions >= 1);
  assert.equal(page.data.images.length, 1);
  assert.equal(page.data.images[0].tempPath, '/tmp/compressed.jpg');
  assert.equal(page.data.images[0].size, 7 * 1024 * 1024);
});

test('images still over 8MB after compression attempts are rejected with a size hint', async () => {
  const { page, pickers, wx, calls } = fixture();
  let compressions = 0;
  wx.compressImage = options => { compressions++; options.fail({ errMsg: 'compressImage:fail' }); };
  wx.getFileInfo = options => options.success({ size: 10 * 1024 * 1024 });
  await page.attachMenu();
  page.selectCommand(event({ id: 'local:image', name: 'image', action: 'image' }));
  await pickers[0].success({ tempFiles: [{ path: '/tmp/huge.jpg', name: 'huge.jpg', size: 10 * 1024 * 1024 }] });
  assert.equal(compressions, 3, 'large images get all available compression attempts');
  assert.equal(page.data.images.length, 0);
  assert.ok(calls.some(call => call[0] === 'toast' && /8MB/.test(call[1])));
});

test('unsupported gateways keep picked documents and explain the required upgrade', async () => {
  const { page, pickers, calls } = fixture(); await page.attachMenu();
  page.selectCommand(event({ id: 'local:chat-file', name: 'chatFile', action: 'chatFile' }));
  assert.equal(pickers.length, 1); assert.equal(pickers[0].type, 'file');
  await pickers[0].success({ tempFiles: [
    { path: '/tmp/report.pdf', name: 'report.pdf', size: 2048, type: 'file' },
    { path: '/tmp/deck.pptx', name: 'deck.pptx', size: 4096, type: 'file' }
  ] });
  assert.equal(page.data.images.length, 2);
  assert.ok(page.data.images.every(item => item.isFile));
  assert.equal(page.data.images[1].name, 'deck.pptx');
  assert.equal(page.data.attachmentPicking, false);
  page.send();
  assert.ok(calls.some(call => call[0] === 'toast' && /升级并重启网关/.test(call[1])));
  assert.ok(!calls.some(call => call[0] === 'send'));
});
test('model shortcut retains provider grouping, selection identity, default effort and draft', () => {
  const { page, store, calls } = fixture();
  page.data.draft = 'Keep this draft';
  store.state.modelCatalog = { groups: [
    { id: 'one', name: 'Provider One', models: [{ id: 'shared', name: 'Model A', reasoning: { defaultEffort: 'high' } }] },
    { id: 'two', name: 'Provider Two', models: [{ id: 'shared', name: 'Model B', reasoning: { defaultEffort: 'low' } }] },
    { id: 'empty', models: [] }
  ] };
  store.sessionState.selection = { provider: 'two', model: 'shared' };
  page.pickModel();
  assert.equal(page.data.modelSheetOpen, true);
  assert.equal(page.data.modelMenuPane, 'root');
  assert.equal(page.data.modelLabel, 'Model B');
  assert.equal(page.data.modelGroups.length, 0);
  page.openModelList();
  assert.equal(page.data.modelMenuPane, 'model');
  assert.deepEqual(Array.from(page.data.modelGroups, g => g.id), ['one', 'two']);
  assert.equal(page.data.modelGroups[0].models[0].current, false);
  assert.equal(page.data.modelGroups[1].models[0].current, true);
  page.pickModelOption(event({ provider: 'one', model: 'shared', effort: 'high' }));
  assert.deepEqual(calls.find(call => call[0] === 'model'), ['model', 's1', 'one', 'shared', 'high']);
  assert.equal(page.data.modelSheetOpen, false);
  assert.equal(page.data.draft, 'Keep this draft');
});
test('two-level model menu opens without a catalog and returns from effort without sending', () => {
  const { page, store, calls } = fixture();
  store.sessionState.selection = { provider: 'provider', model: 'model', reasoningEffort: 'low' };
  page.pickModel();
  assert.equal(page.data.modelMenuPane, 'root');
  assert.equal(page.data.effortLabel, 'Low');
  page.pickEffort();
  assert.equal(page.data.modelSheetOpen, false);
  assert.equal(page.data.effortSheetOpen, true);
  assert.equal(page.data.effortSheet.find(o => o.current).value, 'low');
  page.backToModelMenu();
  assert.equal(page.data.modelSheetOpen, true);
  assert.equal(page.data.effortSheetOpen, false);
  page.pickModel(); assert.equal(page.data.modelSheetOpen, false);
  assert.ok(!calls.some(call => call[0] === 'model' || call[0] === 'send'));
  page.pickModel(); page.pickEffort(); page.pickEffortOption(event({ value: 'high' }));
  assert.deepEqual(calls.find(call => call[0] === 'model'), ['model', 's1', 'provider', 'model', 'high']);
});
test('permission shortcut mirrors desktop labels, auto badge and shield without changing preset values', () => {
  const { page, store, calls } = fixture();
  store.sessionState.permission = 'danger-full-access';
  store.sessionState.permissionOptions = [
    { value: 'read-only', name: 'Read Only' }, { value: 'workspace-write', name: 'Workspace Write' },
    { value: 'danger-full-access', name: 'Full access' }, { value: 'auto', name: 'Auto review' },
    { value: 'custom', name: 'Company policy' }
  ];
  page.pickPermission();
  assert.deepEqual(Array.from(page.data.permissionSheet, o => o.name), ['仅可查看', '工作区内修改', '完全权限', '自动审查', 'Company policy']);
  assert.equal(page.data.permissionSheet[2].current, true);
  assert.equal(page.data.permissionSheet[3].icon, 'shield-auto-gray.svg');
  assert.equal(page.data.permissionSheet[3].badge, 'EXP');
  page.pickPermissionOption(event({ value: 'auto' }));
  assert.deepEqual(calls.find(call => call[0] === 'permission'), ['permission', 's1', 'auto']);
  assert.equal(page.data.permissionIcon, 'shield-auto-gray.svg');
  assert.equal(page.data.permissionSheet.length, 0);
});
test('plus stays useful for commands which refuse attachments and slash uses same rows', async () => {
  const { page } = fixture(); page.data.draft = '/goal task'; page.syncCommandMenu(page.data.draft, { commandGroups: [{ items: [command('goal', 'input')] }] });
  assert.equal(page.data.canAttach, false); await page.attachMenu();
  assert.equal(page.data.commandMenu.type, 'catalog'); assert.ok(!page.data.commandMenu.groups.flatMap(x => x.items).some(x => x.action === 'file' || x.action === 'image'));
  page.closeAttachMenu(); page.onDraftInput({ detail: { value: '/compact', cursor: 8 } });
  assert.equal(page.data.commandMenu.groups[0].items[0].name, 'compact');
  page.closeAttachMenu(); page.syncCommandMenu('/compact', { commandGroups: [{ items: [command('compact')] }] }); assert.equal(page.data.commandMenu, null);
});
test('plus hides Skills but the slash popup keeps the Skills group', async () => {
  const skill = command('review-pr', 'input', { source: 'skill', ui: { kind: 'input', insertText: '/review-pr ' } });
  const { page, store } = fixture([command('compact'), skill]);
  await page.attachMenu();
  assert.ok(!page.data.commandMenu.groups.some(group => group.id === 'skills'));
  page.closeAttachMenu();
  page.syncCommandMenu('/', store.sessionState);
  const skills = page.data.commandMenu.groups.find(group => group.id === 'skills');
  assert.ok(skills); assert.equal(skills.items[0].name, 'review-pr');
});
test('input commands keep the existing task, immediate commands never send the draft', async () => {
  const { page, calls } = fixture(); page.data.draft = 'task to keep';
  page.selectCommand(event({ id: 'command:goal' })); assert.equal(page.data.draft, '/goal task to keep');
  page.data.draft = 'unrelated text'; await page.attachMenu(); await page.selectCommand(event({ id: 'command:compact' }));
  assert.equal(page.data.draft, 'unrelated text'); assert.ok(calls.some(x => x[0] === 'execute' && x[2] === '/compact'));
  assert.ok(!calls.some(x => x[0] === 'send'));
});
test('option actions preserve drafts and apply only a listed option', async () => {
  const { page, calls } = fixture(); page.data.draft = 'keep'; await page.attachMenu();
  await page.selectCommand(event({ id: 'command:model' }));
  assert.equal(page.data.commandMenu.type, 'options'); assert.equal(page.data.draft, 'keep');
  page.onCommandMenuSearch({ detail: { value: 'Second' } }); assert.equal(page.data.commandMenu.options.length, 1);
  await page.selectCommandOption(event({ id: 'unknown' })); assert.ok(!calls.some(x => x[0] === 'select'));
  await page.selectCommandOption(event({ id: 'two' })); assert.equal(page.data.commandMenu, null); assert.equal(page.data.draft, 'keep');
  assert.deepEqual(calls.find(x => x[0] === 'select'), ['select', 's1', 'model', 'two']);
});
test('dismissed or previous-session options cannot resurrect the menu', async () => {
  const { page, store } = fixture(); const request = deferred(); store.client.requestCommandOptions = () => request.promise;
  const pending = page.openCommandOptions('model'); page.closeAttachMenu(); request.resolve({ options: [{ id: 'old', label: 'Old' }] }); await pending;
  assert.equal(page.data.commandMenu, null);
  const next = deferred(); store.client.requestCommands = () => next.promise; const opened = page.attachMenu();
  store.sessionState.sessionId = 's2'; const before = store.sessionState.commandGroups; next.resolve({ groups: [] }); await opened;
  assert.equal(store.sessionState.commandGroups, before);
});
test('option presentation keeps desktop active state and badges through filtering', async () => {
  const { page, store } = fixture();
  store.client.requestCommandOptions = async () => ({ options: [
    { id: 'current', label: 'Current model', detail: 'Default', badge: 'NEW', active: true },
    { id: 'legacy', label: 'Legacy model', description: 'Compatible', selected: true },
    { id: 'other', label: 'Other model', detail: 'Alternative' }
  ] });
  await page.openCommandOptions('model');
  assert.equal(page.data.commandMenu.options[0].selected, true);
  assert.equal(page.data.commandMenu.options[0].badge, 'NEW');
  assert.equal(page.data.commandMenu.options[1].selected, true);
  assert.equal(page.data.commandMenu.options[2].selected, false);
  page.onCommandMenuSearch({ detail: { value: 'Default' } });
  assert.equal(page.data.commandMenu.options.length, 1);
  assert.equal(page.data.commandMenu.options[0].id, 'current');
  assert.equal(page.data.commandMenu.options[0].selected, true);
});
test('failed option lookup shows retry and retry keeps the original draft', async () => {
  const { page, store } = fixture(); page.data.draft = 'keep'; store.client.requestCommandOptions = async () => { throw Error('offline'); };
  await page.openCommandOptions('model'); assert.equal(page.data.commandPaletteLoading, false); assert.equal(page.data.commandPaletteError, 'offline');
  store.client.requestCommandOptions = async () => ({ options: [{ id: 'retry', label: 'Retry' }] });
  await page.refreshComposerCommands(); assert.equal(page.data.commandMenu.options[0].id, 'retry'); assert.equal(page.data.draft, 'keep');
});
test('Chinese permission labels remain searchable and submit unchanged Host ids', async () => {
  const { page, store, calls } = fixture();
  store.client.requestCommandOptions = async () => ({ options: [{ id: 'workspace-write', label: 'Workspace Write' }, { id: 'auto', label: 'Auto review' }] });
  await page.openCommandOptions('permission');
  assert.equal(page.data.commandMenu.title, '权限');
  assert.equal(page.data.commandMenu.options[0].label, '工作区内修改');
  page.onCommandMenuSearch({ detail: { value: '自动审查' } });
  assert.equal(page.data.commandMenu.options[0].id, 'auto');
  await page.selectCommandOption(event({ id: 'auto' }));
  assert.deepEqual(calls.find(call => call[0] === 'select'), ['select', 's1', 'permission', 'auto']);
});
test('duplicate actions and unsupported attachment commands do not execute twice or drop data', async () => {
  const { page, calls, store } = fixture(); page.data.images = [{ id: 'image' }];
  await page.selectCommand(event({ id: 'command:compact' })); assert.ok(!calls.some(x => x[0] === 'execute')); assert.equal(page.data.images.length, 1);
  page.data.images = []; const pending = deferred(); let count = 0; store.client.executeCommand = () => { count++; return pending.promise; };
  const first = page.selectCommand(event({ id: 'command:compact' })); page.selectCommand(event({ id: 'command:compact' }));
  assert.equal(count, 1); pending.resolve(); await first;
});
test('command failure or late settlement keeps typed and newer drafts', async () => {
  const { page, store } = fixture(); page.data.draft = '/compact'; store.client.executeCommand = async () => { throw Error('offline'); };
  await page.selectCommand(event({ id: 'command:compact' })); assert.equal(page.data.draft, '/compact');
  const pending = deferred(); store.client.executeCommand = () => pending.promise; page.data.draft = '/goal old';
  const execution = page.submitCommand(command('goal', 'input'), '/goal old', []);
  page.onDraftInput({ detail: { value: 'new draft', cursor: 9 } }); pending.resolve(); await execution; assert.equal(page.data.draft, 'new draft');
});
test('workspace references quote spaces and ignore closed-directory responses', async () => {
  const { page, store } = fixture(); page.data.draft = 'Read '; page._composerCursor = 5; page.chooseWorkspaceReference();
  await new Promise(resolve => setImmediate(resolve)); page.openSessionFile(event({ index: 0 }));
  // 工作区文件以附件形式暂存（保留原始路径，含空格），草稿文本不变
  assert.equal(page.data.images.length, 1);
  assert.equal(page.data.images[0].isWorkspaceRef, true);
  assert.equal(page.data.images[0].workspaceKind, 'file');
  assert.equal(page.data.images[0].path, 'src/a b.js');
  assert.equal(page.data.draft, 'Read ');
  assert.equal(page.data.canSend, true);
  assert.equal(page.data.filesSheetOpen, false);
  const pending = deferred(); store.client.requestFileList = () => pending.promise; page.openFilesSheet(true); page.closeFilesSheet();
  pending.resolve({ entries: [{ name: 'late', path: 'late', kind: 'file' }] }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.filesEntries.length, 0);
});
test('@ opens inline workspace candidates, filters by typed path, and drills into directories', async () => {
  const { page, store, calls } = fixture();
  const listings = {
    root: [
      { name: 'src', path: 'src', kind: 'directory' },
      { name: 'README.md', path: 'README.md', kind: 'file' }
    ],
    src: [{ name: 'a file.js', path: 'src/a file.js', kind: 'file' }]
  };
  store.client.requestFileList = async (id, directory) => {
    calls.push(['file-list', id, directory || 'root']);
    return { path: directory || '.', entries: listings[directory || 'root'] || [] };
  };
  page.onDraftInput({ detail: { value: 'Review @', cursor: 8 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.fileMentionOpen, true);
  assert.deepEqual(Array.from(page.data.fileMentionEntries, row => row.name), ['src', 'README.md']);
  assert.ok(calls.some(call => call[0] === 'file-list' && call[2] === 'root'));

  page.drillFileMention(event({ index: 0 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.draft, 'Review @src/');
  assert.deepEqual(Array.from(page.data.fileMentionEntries, row => row.name), ['a file.js']);
  page.selectFileMention(event({ index: 0 }));
  assert.equal(page.data.draft, 'Review @"src/a file.js"');
  // 光标是显示值坐标：引用位置是零宽占位符，光标停在占位符之后。
  assert.equal(page.data.composerCursor, page.data.composerValue.length);
  assert.equal(page.data.composerValue, 'Review ' + require('../miniprogram/pages/session/utils/composer-menu').REF_PLACEHOLDER);
  assert.equal(page.data.fileMentionOpen, false);
  assert.equal(page.data.images.length, 0, 'file references are inserted into the prompt, not staged as attachments');
});
test('@ candidate results follow the latest path and closed menus ignore late responses', async () => {
  const { page, store } = fixture();
  const root = deferred(), nested = deferred(), closed = deferred();
  const requests = [];
  store.client.requestFileList = (id, directory) => {
    requests.push(directory || '.');
    return requests.length === 1 ? root.promise : requests.length === 2 ? nested.promise : closed.promise;
  };

  page.onDraftInput({ detail: { value: '@', cursor: 1 } });
  page.onDraftInput({ detail: { value: '@src/', cursor: 5 } });
  assert.deepEqual(requests, ['.', 'src']);
  nested.resolve({ entries: [{ name: 'index.js', path: 'src/index.js', kind: 'file' }] });
  await new Promise(resolve => setImmediate(resolve));
  root.resolve({ entries: [{ name: 'README.md', path: 'README.md', kind: 'file' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.fileMentionPathLabel, 'src');
  assert.deepEqual(Array.from(page.data.fileMentionEntries, row => row.name), ['index.js']);

  page.onDraftInput({ detail: { value: '@other', cursor: 6 } });
  page.closeFileMention();
  closed.resolve({ entries: [{ name: 'late.js', path: 'late.js', kind: 'file' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.fileMentionOpen, false);
  assert.deepEqual(Array.from(page.data.fileMentionEntries), []);
});
test('@ workspace picker is mounted above the composer and binds selection and directory navigation', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const dockStart = wxml.indexOf('class="dock-stack');
  const picker = wxml.indexOf('class="file-mention-menu"');
  const pickerOpen = wxml.lastIndexOf('<view wx:if="{{fileMentionOpen}}"', picker);
  const composer = wxml.indexOf('class="composer-surface');
  assert.ok(dockStart >= 0 && picker > dockStart && composer > picker, 'picker must render within the conversation dock before the composer');
  assert.ok(pickerOpen >= dockStart && pickerOpen < picker);
  assert.match(wxml.slice(pickerOpen, composer), /wx:if="\{\{fileMentionOpen\}\}"/);
  assert.match(wxml.slice(pickerOpen, composer), /bindtap="selectFileMention"/);
  assert.match(wxml.slice(pickerOpen, composer), /catchtap="drillFileMention"/);
  assert.match(wxml.slice(composer), /cursor="\{\{composerCursor\}\}"[\s\S]*bindinput="onDraftInput"/);
});
test('image picker detects MIME, previews originals, enforces size and never uploads PDFs as images', async () => {
  const { page, pickers, calls } = fixture(); page.chooseImage();
  await pickers[0].success({ tempFiles: [{ tempFilePath: '/tmp/photo', size: 42 }, { tempFilePath: '/tmp/huge', size: 9 * 1024 * 1024 }] });
  assert.equal(page.data.images.length, 1); assert.equal(page.data.images[0].mediaType, 'image/png');
  page.previewPendingImage(event({ index: 0 }));
  assert.ok(page.data.filePreview, 'a pending image opens the unified preview sheet');
  assert.equal(page.data.filePreview.previewKind, 'image');
  assert.equal(page.data.filePreview.localPath, '/tmp/photo');
  assert.equal(page.data.filePreview.primary, '查看原图');
  assert.ok(!calls.some(x => x[0] === 'preview'), 'the native viewer waits for the primary action');
  page.filePreviewPrimary(); assert.ok(calls.some(x => x[0] === 'preview'));
  page.chooseFile(); assert.equal(pickers[1].type, 'image'); pickers[1].fail({ errMsg: 'choose:fail cancel' }); assert.equal(page.data.attachmentPicking, false);
  page.data.images = [{ isFile: true, mediaType: 'application/pdf' }]; page.send(); assert.ok(!calls.some(x => x[0] === 'send'));
});
test('late picker results cannot cross sessions and duplicate pickers are blocked', async () => {
  const { page, store, pickers } = fixture(); page.chooseImage(); page.chooseImage(); assert.equal(pickers.length, 1);
  store.sessionState.sessionId = 's2'; await pickers[0].success({ tempFiles: [{ tempFilePath: '/tmp/old', size: 10 }] });
  assert.equal(page.data.images.length, 0);
});
test('send refusal keeps draft; while reading attachments send is locked and scope is checked', async () => {
  const { page, store, calls, reads } = fixture(); page.data.draft = 'keep'; store.client.sendMessage = () => false;
  await page.send(); assert.equal(page.data.draft, 'keep');
  page.data.images = [{ id: 'i', tempPath: '/tmp/i', mediaType: 'image/png', name: 'i.png' }];
  const pending = page.send(); page.send(); assert.equal(reads.length, 1);
  store.sessionState.sessionId = 's2'; reads[0].success({ data: 'aGVsbG8=' }); await pending; assert.ok(!calls.some(x => x[0] === 'send')); assert.equal(page.data.draft, 'keep');
});
test('normal messages send immediately; running messages use the gateway queue for automatic post-run delivery', async () => {
  const { page, store, calls, reads } = fixture(); page.data.draft = 'image task'; page.data.images = [{ id: 'i', tempPath: '/tmp/i', mediaType: 'image/png', name: 'i.png' }];
  const pending = page.send(); reads[0].success({ data: 'aGVsbG8=' }); await pending;
  const sent = calls.find(x => x[0] === 'send'); assert.equal(sent[5], undefined); assert.equal(sent[4][0].mediaType, 'image/png'); assert.equal(page.data.draft, '');
  store.sessionState.running = true; page.data.draft = 'next'; await page.send();
  const queued = calls.filter(x => x[0] === 'send').at(-1);
  assert.equal(queued[1], 'next');
  assert.equal(queued[5], 'queue', 'the host owns the queue and sends the item after the active turn ends');
  assert.equal(page.data.queue.length, 0, 'do not show an unacknowledged local duplicate');
  assert.equal(page.data.draft, '');
});
test('slash message commands also enter the gateway queue during an active run', async () => {
  const prompt = command('prompt', 'immediate', { ui: { kind: 'immediate', submitRequest: 'message' } });
  const { page, store, calls } = fixture([prompt]);
  store.sessionState.running = true;
  page._activeCommand = prompt;
  page.data.draft = 'continue after this turn';

  await page.send();

  const sent = calls.filter(call => call[0] === 'send').at(-1);
  assert.equal(sent[1], 'continue after this turn');
  assert.equal(sent[5], 'queue');
  assert.equal(page.data.draft, '');
});
test('queued messages are shown from the gateway and can still be removed', async () => {
  const { page, store, calls } = fixture();
  store.sessionState.queue = [{ id: 'gateway-queue-1', text: 'after-run' }];
  page.syncQueueDock();
  assert.equal(page.data.queue[0].id, 'gateway-queue-1');
  assert.equal(page.data.queue[0].rawText, 'after-run');
  page.queueAction(event({ id: 'gateway-queue-1', action: 'remove' }));
  assert.deepEqual(calls.filter(x => x[0] === 'queueUpdate').at(-1),
    ['queueUpdate', 's1', 'gateway-queue-1', 'remove']);
  clearTimeout(page._queueTimer);
});
test('external file messages queued during a run retain gateway queue mode', async () => {
  const { page, store, calls, wx } = fixture();
  store.sessionState.running = true;
  store.state.gatewayCapabilities = ['file-upload-v1'];
  store.client.timeZone = () => 'Asia/Shanghai';
  store.client.requestUpload = async (action, payload) => {
    calls.push(['upload', action, payload]);
    if (action === 'open') return { sessionId: 's1', uploadId: 'u1', size: 0, chunkBytes: 1024 };
    if (action === 'finish') return { sessionId: 's1', uploadId: 'u1', receiptId: 'r1',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      file: { attachmentId: 'a1', name: 'empty.txt', bytes: 0 } };
    return {};
  };
  wx.getFileSystemManager = () => ({
    stat: options => options.success({ stats: { size: 0 } }),
    open: options => options.success({ fd: 'fd1' }),
    close: options => options.success({})
  });
  page.data.draft = 'send this file after the turn';
  page.data.images = [{ isFile: true, name: 'empty.txt', tempPath: '/tmp/empty.txt' }];

  await page.send();

  const message = calls.find(call => call[0] === 'upload' && call[1] === 'message')[2];
  assert.equal(message.mode, 'queue');
  assert.equal(message.files[0].receiptId, 'r1');
  assert.equal(page.data.draft, '');
});
test('successful send resets an old scroll gesture and immediately follows the tail', async () => {
  const {page,store}=fixture();let scrolls=0;page.refreshBottomAnchor=()=>scrolls++;
  page._convPinned=false;page._lastTouchAt=Date.now();page.data.showJump=true;page.data.draft='new task';
  await page.send();
  assert.equal(page._convPinned,true);assert.equal(page._lastTouchAt,0);assert.equal(page.data.showJump,false);assert.equal(scrolls,1);
  page._convPinned=false;page.data.draft='retry';store.client.sendMessage=()=>false;await page.send();
  assert.equal(page._convPinned,false);assert.equal(scrolls,1);assert.equal(page.data.draft,'retry');
});
const compiler = require('./helpers/wechat-wcc.cjs');
test('native WXML renders the plus menu, choices and blocked-attachment plus in both themes', { skip: !compiler }, () => {
  const root = path.resolve(__dirname, '../miniprogram'), output = path.join(os.tmpdir(), 'dsh-composer-' + process.pid + '.js');
  try {
    execFileSync(compiler, ['-o', output, 'pages/session/session.wxml'], { cwd: root });
    const context = vm.createContext({ window: {}, console }); vm.runInContext(fs.readFileSync(output, 'utf8'), context); const render = context.$gwx('pages/session/session.wxml');
    for (const theme of ['light', 'dark']) for (const type of ['catalog', 'options']) {
      const { page, store } = fixture(); Object.assign(page.data, preferences.snapshot(), { theme, canAttach: false, attachSheetOpen: true, commandMenu: { type, title: '/model', groups: menu.catalog(store.sessionState.commandGroups, { t: preferences.t, dark: theme === 'dark' }), options: [{ id: 'one', label: 'First option', detail: 'Primary option', badge: 'NEW', selected: true }, { id: 'two', label: 'Second option', detail: 'Alternative', selected: false }] } });
      const rendered = render(page.data, {}, {}), tree = JSON.stringify(rendered); assert.ok(tree.includes('composer-plus'));
      assert.equal(tree.includes('command-menu-toolbar'), type !== 'catalog');
      const nodes = [];
      function walk(node) { if (!node || typeof node !== 'object') return; if (node.attr) nodes.push(node); (node.children || []).forEach(walk); }
      walk(rendered);
      const hasClass = (node, name) => String(node.attr.class || '').split(/\s+/).includes(name);
      const rows = nodes.filter(node => hasClass(node, type === 'options' ? 'command-option' : 'command-row'));
      assert.ok(rows.length);
      for (const row of rows) {
        assert.equal(row.attr.hoverClass, 'command-row-pressed');
        assert.equal(String(row.attr.hoverStartTime), '0');
        assert.equal(String(row.attr.hoverStayTime), '100');
        if (type !== 'options') {
          assert.ok(hasClass(row.children[0], 'command-menu-icon-slot'));
          assert.equal(row.children[0].children[0].attr.mode, 'aspectFit');
        }
      }
      if (type === 'catalog') {
        assert.ok(tree.includes('目标')); assert.ok(tree.includes('指令'));
        assert.ok(tree.includes('command-identity')); assert.ok(tree.includes('command-alias'));
        assert.ok(!tree.includes('command-chev')); assert.ok(!tree.includes('command-option-main'));
        assert.ok(!JSON.stringify(rows[0]).includes('command-desc'));
        assert.ok(nodes.some(node => hasClass(node, 'command-alias') && JSON.stringify(node.children).includes('goal')));
        for (const label of ['添加图片', '聊天中的图片', '工作区文件', '聊天中的文件']) assert.ok(tree.includes(label), label);
        assert.ok(rows.some(row => JSON.stringify(row).includes('menu-image.svg')));
        assert.ok(rows.some(row => JSON.stringify(row).includes('menu-chat-image.svg')));
        assert.ok(rows.some(row => JSON.stringify(row).includes('menu-folder.svg')));
        assert.ok(rows.some(row => JSON.stringify(row).includes('menu-chat-file.svg')));
        assert.ok(!tree.includes('command-menu-return'));
      }
      if (type === 'options') {
        assert.ok(tree.includes('First option'));
        assert.ok(tree.includes('command-options-return'));
        assert.ok(tree.includes('command-search-field'));
        assert.ok(!tree.includes('command-menu-title'));
        assert.ok(hasClass(rows[0], 'selected'));
        assert.ok(!hasClass(rows[1], 'selected'));
        assert.equal(String(rows[0].attr.ariaPressed), 'true');
        assert.equal(String(rows[1].attr.ariaPressed), 'false');
        assert.ok(rows.every(row => row.children.some(child => hasClass(child, 'command-option-detail'))));
        assert.equal(nodes.filter(node => hasClass(node, 'command-check-slot')).length, 2);
        assert.equal(nodes.filter(node => hasClass(node, 'command-check')).length, 1);
        assert.ok(nodes.some(node => hasClass(node, 'command-option-badge') && node.children.includes('NEW')));
      }
    }
    for (const theme of ['light', 'dark']) {
      const { page, store } = fixture();
      store.state.modelCatalog = { groups: [{ id: 'deepseek-account', name: 'DeepSeek Account', models: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }, { id: 'deepseek-pro', name: 'DeepSeek-V4.1-Pro' }] }] };
      store.sessionState.selection = { provider: 'deepseek-account', model: 'deepseek-pro' };
      page.pickModel(); Object.assign(page.data, preferences.snapshot(), { theme });
      const rootRendered = render(page.data, {}, {}), rootTree = JSON.stringify(rootRendered);
      const rootNodes = [];
      function collect(node) { if (!node || typeof node !== 'object') return; if (node.attr) rootNodes.push(node); (node.children || []).forEach(collect); }
      collect(rootRendered);
      const trigger = rootNodes.find(node => node.attr.bindtap === 'pickModel');
      assert.equal(trigger.attr.hoverClass, 'model-trigger-pressed');
      assert.equal(String(trigger.attr.hoverStartTime), '0');
      assert.equal(String(trigger.attr.hoverStayTime), '100');
      assert.equal(String(trigger.attr.ariaExpanded), 'true');
      const triggerChildren = trigger.children.filter(node => node && node.attr);
      assert.equal(triggerChildren[0].attr.class, 'chip-model-name');
      assert.equal(triggerChildren[1].attr.class, 'model-trigger-effort');
      assert.ok(triggerChildren[2].attr.class.includes('model-trigger-chevron'));
      assert.ok(triggerChildren[2].attr.class.includes('open'));
      assert.ok(triggerChildren.every(node => !node.attr.catchtap && !node.attr.bindtap));
      assert.ok(rootTree.includes('model-root'));
      assert.ok(rootTree.includes('推理等级'));
      assert.ok(rootTree.includes('openModelList'));
      assert.ok(!rootTree.includes('pickModelOption'));
      assert.equal((rootTree.match(/model-menu-entry/g) || []).length, 2);
      page.pickEffort();
      const effortTree = JSON.stringify(render(page.data, {}, {}));
      assert.ok(effortTree.includes('backToModelMenu'));
      assert.ok(effortTree.includes('pickEffortOption'));
      assert.ok(!effortTree.includes('model-radio'));
      page.backToModelMenu(); page.openModelList();
      const nodes = [];
      function walk(node) { if (!node || typeof node !== 'object') return; if (node.attr) nodes.push(node); (node.children || []).forEach(walk); }
      walk(render(page.data, {}, {}));
      const hasClass = (node, name) => String(node.attr.class || '').split(/\s+/).includes(name);
      const rows = nodes.filter(node => node.attr.bindtap === 'pickModelOption');
      assert.equal(rows.length, 2);
      assert.equal(nodes.filter(node => hasClass(node, 'model-check')).length, 1);
      assert.ok(!nodes.some(node => hasClass(node, 'model-radio')));
      assert.ok(nodes.some(node => hasClass(node, 'model-group-title') && node.children.includes('DeepSeek 账号')));
      assert.ok(!nodes.some(node => hasClass(node, 'model-menu-back')));
      const badge = rows[0].children[0].children.find(node => node.attr && hasClass(node, 'model-release-badge'));
      assert.ok(badge.children.includes('1017'));
      assert.ok(!JSON.stringify(rows[1]).includes('model-release-badge'));
      for (const row of rows) {
        assert.equal(row.attr.hoverClass, 'model-row-pressed');
        assert.equal(String(row.attr.hoverStartTime), '0');
        assert.ok(hasClass(row.children[0], 'model-identity'));
        assert.ok(hasClass(row.children[0].children[0], 'model-name'));
        assert.ok(hasClass(row.children[1], 'model-check-slot'));
      }
      assert.equal(String(rows[1].attr.ariaPressed), 'true');
    }
    for (const theme of ['light', 'dark']) {
      const { page, store } = fixture();
      store.sessionState.permission = 'auto'; page.pickPermission();
      Object.assign(page.data, preferences.snapshot(), { theme });
      const nodes = [];
      function walk(node) { if (!node || typeof node !== 'object') return; if (node.attr) nodes.push(node); (node.children || []).forEach(walk); }
      walk(render(page.data, {}, {}));
      const hasClass = (node, name) => String(node.attr.class || '').split(/\s+/).includes(name);
      const rows = nodes.filter(node => node.attr.bindtap === 'pickPermissionOption');
      assert.equal(rows.length, 4);
      for (const row of rows) {
        assert.equal(row.attr.hoverClass, 'permission-row-pressed');
        assert.equal(String(row.attr.hoverStartTime), '0');
        assert.ok(hasClass(row.children[0], 'permission-icon-slot'));
        assert.equal(row.children[0].children[0].attr.mode, 'aspectFit');
      }
      assert.equal(rows[3].children[0].children[0].attr.src, '/assets/icons/shield-auto-gray.svg');
      assert.ok(hasClass(rows[3], 'current'));
      assert.equal(nodes.filter(node => hasClass(node, 'permission-check')).length, 1);
      assert.ok(nodes.some(node => hasClass(node, 'permission-option-badge') && node.children.includes('EXP')));
    }
    for (const theme of ['light', 'dark']) for (const kind of ['run', 'token']) {
      const { page } = fixture();
      page[kind === 'run' ? 'showStats' : 'showTokenStats']();
      Object.assign(page.data, preferences.snapshot(), { theme });
      const nodes = [];
      function walk(node) { if (!node || typeof node !== 'object') return; if (node.attr) nodes.push(node); (node.children || []).forEach(walk); }
      walk(render(page.data, {}, {}));
      const title = nodes.find(node => node.attr.class === 'stats-pop-title');
      assert.ok(title);
      assert.equal(title.children[0].attr.src, '/assets/icons/' + (kind === 'run' ? 'dsh-gauge' : 'dsh-storage') + '.svg');
      assert.equal(title.children[0].attr.mode, 'aspectFit');
      assert.equal(title.children[1].attr.class, 'stats-pop-heading');
      assert.ok(title.children[1].children.includes(kind === 'run' ? '会话统计' : 'Token 用量'));
      assert.equal(title.children.some(node => node.attr && node.attr.class === 'stats-pop-total'), kind === 'token');
    }
    for (const theme of ['light', 'dark']) {
      const { page } = fixture();
      Object.assign(page.data, preferences.snapshot(), { theme, fileMentionOpen: true, fileMentionPathLabel: 'src', fileMentionEntries: [
        { name: 'components', path: 'src/components', kind: 'dir', iconFile: 'folder-ink.png', key: 'src/components:0' },
        { name: 'view.js', path: 'src/view.js', kind: 'file', iconFile: 'doc-ocean.png', key: 'src/view.js:1' }
      ] });
      const rendered = render(page.data, {}, {}), nodes = [];
      function walk(node) { if (!node || typeof node !== 'object') return; if (node.attr) nodes.push(node); (node.children || []).forEach(walk); }
      walk(rendered);
      const hasClass = (node, name) => String(node.attr.class || '').split(/\s+/).includes(name);
      const rows = nodes.filter(node => hasClass(node, 'file-mention-row'));
      assert.equal(rows.length, 2);
      assert.ok(rows.every(row => row.attr.bindtap === 'selectFileMention'));
      const drill = nodes.find(node => hasClass(node, 'file-mention-drill'));
      assert.ok(drill);
      assert.equal(drill.attr.catchtap, 'drillFileMention');
      assert.ok(nodes.some(node => hasClass(node, 'file-mention-title') && node.children.includes('文件与文件夹')));
    }
  } finally { if (fs.existsSync(output)) fs.unlinkSync(output); }
});
test('statistics title icons use full-contrast colors without changing footer icons', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8').replace(/\s+/g, '');
  assert.ok(css.includes('.stats-pop-title.metric-icon{filter:brightness(0);opacity:1}'));
  assert.ok(css.includes('.theme-dark.stats-pop-title.metric-icon{filter:brightness(0)invert(1);opacity:1}'));
  assert.ok(css.includes('.theme-dark.metric-icon{filter:brightness(0)invert(1);opacity:0.82;}'));
});
test('model trigger presents effort as plain muted text with one hover and touch target', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8').replace(/\s+/g, '');
  const effort = css.match(/\.model-trigger-effort\{([^}]+)\}/)[1];
  assert.ok(effort.includes('color:var(--text-4)'));
  assert.doesNotMatch(effort, /background|border|padding|margin|font-weight/);
  assert.ok(!css.includes('.effort-pill'));
  assert.ok(css.includes('.composer-bar.chip.model-chip{height:44px}'));
  assert.ok(css.includes('.model-chip.model-trigger-pressed,.model-chip:active,.model-chip:focus-visible{background:var(--fill-2)}'));
  assert.ok(css.includes('.model-trigger-chevron.open{transform:translateY(1px)rotate(225deg)}'));
  const xml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const trigger = xml.match(/<view class="chip model-chip"[^]*?<view class="model-trigger-chevron[^]*?<\/view><\/view>/)[0];
  const order = ['chip-model-name', 'model-release-badge', 'model-trigger-effort', 'model-trigger-chevron'].map(name => trigger.indexOf(name));
  assert.ok(order.every((value, index) => value >= 0 && (!index || value > order[index - 1])));
  assert.equal((trigger.match(/bindtap=/g) || []).length, 1);
});
test('menu uses compact rows, trailing checks, right-aligned details and pointer feedback', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8').replace(/\s+/g, '');
  for (const rule of [
    '.command-identity{display:flex;align-items:baseline;',
    'text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
    '@media(hover:hover)and(pointer:fine){.command-row:hover,.command-option:hover{background:var(--fill-2)}',
    '.command-row-pressed{background:var(--fill-2)}',
    '.command-menu-icon-slot{width:20px;height:20px;flex:0020px;display:flex;align-items:center;justify-content:center}',
    '.command-check-slot{width:14px;height:18px;flex:0014px;margin-left:auto;',
    '.command-options.command-option,.command-options-return{min-height:44px}',
    '.opt-pop.permission-pop.opt-row:hover{background:var(--fill-2)}',
    '.opt-pop.permission-pop.opt-row{min-height:44px}',
    '.model-pop.model-row:hover,.model-chip:hover{background:var(--fill-2)}',
    '.model-pop.model-row{min-height:44px}',
    '.model-entry-value{flex:1;min-width:0;display:flex;align-items:center;justify-content:flex-end;'
  ]) assert.ok(css.includes(rule), rule);
});

test('input commands render a blue token chip and keep the hint as placeholder', () => {
  const { page } = fixture();
  page.selectCommand(event({ id: 'command:goal', name: 'goal' }));
  assert.equal(page.data.draft, '/goal ');
  assert.equal(page.data.commandToken, '/goal');
  assert.equal(page.data.commandTokenLabel, '/目标');
  assert.equal(page.data.draftArg, '', 'textarea only edits the argument');

  page.onDraftInput({ detail: { value: '写一份报告', cursor: 5 } });
  assert.equal(page.data.draft, '/goal 写一份报告');
  assert.equal(page.data.draftArg, '写一份报告');

  page.clearCommandToken();
  assert.equal(page.data.draft, '写一份报告');
  assert.equal(page.data.commandToken, '');
  assert.equal(page.data.draftArg, '写一份报告');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.js'), 'utf8');
  assert.match(wxml, /class="composer-input-row composer-live/);
  assert.match(wxml, /catchtap="clearCommandToken"/);
    // textarea 改绑 composerValue：用户打字/删除零数据桥回写（否则连删卡顿）；
  // 程序化改写（清空/恢复/插指令）统一走 setComposerValue。
  assert.match(wxml, /value="\{\{composerValue\}\}"/);
  assert.match(js, /setComposerValue\(/);
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  assert.match(wxss, /\.composer-slash-token \{[^}]*color:\s*var\(--ocean\)/);
});

test('typing around a reference chip keeps the raw draft and the placeholder display aligned', () => {
  const { page } = fixture();
  const menu = require('../miniprogram/pages/session/utils/composer-menu');
  const ref = menu.sessionReference('s1', '另一个会话');
  page.setComposerValue(ref + ' 看看这段', { canSend: true });
  assert.equal(page.data.draft, ref + ' 看看这段');
  assert.equal(page.data.composerValue, menu.REF_PLACEHOLDER + ' 看看这段');
  assert.deepEqual(page.data.composerRefs.map(r => [r.kind, r.label]), [['session', '另一个会话']]);

  // 在 chip 后面继续打字：chips 不动，草稿原样拼接
  page.onDraftInput({ detail: { value: menu.REF_PLACEHOLDER + ' 看看这段代码', cursor: 99 } });
  assert.equal(page.data.draft, ref + ' 看看这段代码');
  assert.equal(page.data.composerRefs.length, 1);

  // 删掉零宽占位符 = 移除整个引用 chip（输入内容以镜像为准，不回写 data）
  const display = page.composerDisplay();
  page.onDraftInput({ detail: { value: display.slice(1), cursor: 0 } });
  assert.equal(page.data.draft, ' 看看这段代码');
  assert.deepEqual(page.data.composerRefs, []);
  assert.equal(page.composerDisplay(), ' 看看这段代码');
});

test('removeComposerRef drops the placeholder and rebuilds the draft without the reference', () => {
  const { page } = fixture();
  const menu = require('../miniprogram/pages/session/utils/composer-menu');
  const draft = 'A ' + menu.sessionReference('s1', 'one') + ' B ' + menu.fileReference('licenses/') + ' C';
  page.setComposerValue(draft, { canSend: true });
  assert.equal(page.data.composerRefs.length, 2);

  page.removeComposerRef(event({ index: 0 }));
  assert.deepEqual(page.data.composerRefs.map(r => r.label), ['licenses/']);
  assert.equal(page.data.draft, 'A  B ' + menu.fileReference('licenses/') + ' C');
  assert.equal(page.data.composerValue, 'A  B ' + menu.REF_PLACEHOLDER + ' C');
  assert.equal(page.data.canSend, true);

  page.removeComposerRef(event({ index: 0 }));
  assert.deepEqual(page.data.composerRefs, []);
  assert.equal(page.data.draft, 'A  B  C');
  assert.equal(page.data.canSend, true, 'remaining text keeps send enabled');
  page.setComposerValue('', { canSend: false });
  page.removeComposerRef(event({ index: 0 }));
  assert.equal(page.data.draft, '', 'removing from an empty composer is a no-op');
});

test('the composer renders a reference chip row above the textarea with typed icons and removal', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const start = wxml.indexOf('class="composer-slash-chip');
  // 目标卡片的就地编辑框也是一个 textarea，按 composer-input 精确定位输入框。
  const composerAt = wxml.lastIndexOf('<textarea', wxml.indexOf('class="composer-input"'));
  const row = wxml.slice(start, composerAt);
  assert.match(row, /<view hidden="\{\{!composerRefs.length\}\}" class="composer-refs/);
  assert.match(row, /wx:for="\{\{composerRefs\}\}" wx:key="key"/);
  assert.match(row, /src="\/assets\/icons\/\{\{item.icon\}\}"/);
  assert.match(row, /catchtap="removeComposerRef"/);
  assert.ok(wxml.indexOf('class="composer-refs') < composerAt, 'chips render before the textarea');
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8').replace(/\s+/g, '');
  assert.ok(css.includes('.composer-refs{display:none;flex-wrap:wrap;'));
  assert.ok(css.includes('.composer-refs[hidden]{display:none!important;}'));
  assert.ok(css.includes('.composer-ref-label{min-width:0;max-width:520rpx;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:28rpx;line-height:1.4;color:#5483E8;}'));
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.js'), 'utf8');
  assert.match(js, /composerRefs: \[\],/);
});

test('selecting one input command renders the token once: the textarea keeps only the argument', () => {
  const { page } = fixture([command('goal', 'input'), command('plan', 'input'), command('compact'), command('model', 'select'), command('permission', 'select')]);
  const menu = require('../miniprogram/pages/session/utils/composer-menu');
  page.selectCommand(event({ id: 'command:goal', name: 'goal' }));
  // chip 承载 token，textarea 只留参数（空参数时连占位文案都是指令提示）
  assert.equal(page.data.draft, '/goal ');
  assert.equal(page.data.commandToken, '/goal');
  assert.equal(page.data.composerValue, '', 'the textarea must not repeat the token');
  assert.equal(page.composerDisplay(), '');
  assert.equal(page.data.composerRefs.length, 0);

  // 继续打参数：草稿拼回 token，显示值仍然只有参数（打字不回写 data，以镜像为准）
  page.onDraftInput({ detail: { value: '写一份报告', cursor: 5 } });
  assert.equal(page.data.draft, '/goal 写一份报告');
  assert.equal(page.composerDisplay(), '写一份报告');

  // 连选第二个指令：旧 token 被替换，不会残留两份
  page.selectCommand(event({ id: 'command:plan', name: 'plan' }));
  assert.equal(page.data.draft, '/plan 写一份报告');
  assert.equal(page.data.commandToken, '/plan');
  assert.equal(page.composerDisplay(), '写一份报告');

  // × 移除指令：参数留在草稿里，chip 消失
  page.clearCommandToken();
  assert.equal(page.data.draft, '写一份报告');
  assert.equal(page.data.commandToken, '');
  assert.equal(page.composerDisplay(), '写一份报告');
});

test('command token survives reference insertion, voice input and chip removal', async () => {
  const { page, store } = fixture();
  const menu = require('../miniprogram/pages/session/utils/composer-menu');
  page.selectCommand(event({ id: 'command:goal', name: 'goal' }));
  assert.equal(page.data.composerValue, '');

  // 指令激活时插入引用：草稿 = token + 参数，显示值里引用是占位符
  store.client.requestFileList = async () => ({ path: '.', entries: [{ name: 'readme.md', path: 'readme.md', kind: 'file' }] });
  page.trackFileMention('@', 1);
  await Promise.resolve();
  await Promise.resolve();
  page.selectFileMention(event({ index: 0 }));
  assert.equal(page.data.draft, '/goal @readme.md');
  assert.equal(page.composerDisplay(), menu.REF_PLACEHOLDER);
  assert.deepEqual(page.data.composerRefs.map(ref => ref.label), ['readme.md']);

  // 语音识别文字插入：token 不丢（光标在 chip 之后，文字落在 chip 后面）
  page.insertVoiceText('识别文字');
  assert.equal(page.data.draft, '/goal ' + menu.fileReference('readme.md') + '识别文字');
  assert.equal(page.composerDisplay(), menu.REF_PLACEHOLDER + '识别文字');
  // 真实应用里 voice mixin 与页面共用一个 store：重新同步后指令 chip 仍在
  page.syncCommandMenu(page.data.draft, store.sessionState);
  assert.equal(page.data.commandToken, '/goal');

  // 移除引用 chip：token 与其余文本原样保留
  page.removeComposerRef(event({ index: 0 }));
  assert.equal(page.data.draft, '/goal 识别文字');
  assert.equal(page.composerDisplay(), '识别文字');
  assert.equal(page.data.commandToken, '/goal');
});

test('the goal card edits inline instead of opening a modal, and keeps pause wired', async () => {
  const { page, calls, store } = fixture();
  store.mutateGoal = (...args) => { calls.push(['goal', ...args]); return Promise.resolve(true); };
  page.data.goal = { id: 'g1', revision: 2, objective: '旧目标', phase: 'active', phaseLabel: '进行中的目标',
    active: true, actionIcon: 'goal-pause.svg', actionIconDark: 'goal-pause-dark.svg' };
  // 点编辑：直接进就地编辑，不弹窗
  page.goalAction(event({ action: 'edit' }));
  assert.equal(page.data.goalEditing, true);
  assert.equal(page.data.goalDraft, '旧目标');
  // 改完保存：提交 goal-edit 并退出编辑态
  page.goalDraftInput({ detail: { value: '新目标' } });
  page.goalSaveEdit();
  assert.equal(page.data.goalEditing, false);
  assert.deepEqual(calls.filter(x => x[0] === 'goal'), [['goal', 'goal-edit', '新目标']]);
  // 没改动就保存：不发请求
  page.goalAction(event({ action: 'edit' }));
  page.goalSaveEdit();
  assert.equal(calls.filter(x => x[0] === 'goal').length, 1, 'unchanged objective is not resubmitted');
  // 取消：丢弃草稿，不发请求
  page.goalAction(event({ action: 'edit' }));
  page.goalDraftInput({ detail: { value: '改了一半' } });
  page.goalCancelEdit();
  assert.equal(page.data.goalEditing, false);
  assert.equal(calls.filter(x => x[0] === 'goal').length, 1, 'cancel does not submit');
  // 暂停/继续仍走 mutateGoal（按当前 phase 选 kind）
  page.goalAction(event({ action: 'toggle' }));
  assert.deepEqual(calls.filter(x => x[0] === 'goal').at(-1), ['goal', 'goal-pause']);
  page.data.goal.active = false;
  page.goalAction(event({ action: 'toggle' }));
  assert.deepEqual(calls.filter(x => x[0] === 'goal').at(-1), ['goal', 'goal-resume']);
});

test('queued messages can be removed one after another without re-entering the session', async () => {
  const { page, calls, store } = fixture();
  page.data.queue = [
    { id: 'q1', editable: true, rawText: '一', preview: '一', attachments: [] },
    { id: 'q2', editable: true, rawText: '二', preview: '二', attachments: [] }
  ];
  store.client.queueUpdate = (...args) => { calls.push(['queueUpdate', ...args]); return Promise.resolve(true); };
  page.queueAction(event({ id: 'q1', action: 'remove' }));
  assert.equal(page.data.queueBusyId, 'q1:remove');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.data.queueBusyId, '', '回执到达后必须立即解锁');
  page.queueAction(event({ id: 'q2', action: 'remove' }));
  assert.deepEqual(calls.filter(x => x[0] === 'queueUpdate').map(x => x.slice(1)),
    [['s1', 'q1', 'remove'], ['s1', 'q2', 'remove']], '第二条条目的点击不能被锁吞掉');
});
