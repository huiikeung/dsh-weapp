const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const preferences = require('../miniprogram/utils/ui-preferences');
const menu = require('../miniprogram/utils/composer-menu');
const command = (name, kind = 'immediate', extras = {}) => ({ id: 'command:' + name, name, description: name, source: 'host', ui: { kind, submitRequest: 'command-execute' }, ...extras });
const event = data => ({ currentTarget: { dataset: data } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(items = [command('goal', 'input'), command('compact'), command('model', 'select'), command('permission', 'select')]) {
  const file = path.resolve(__dirname, '../miniprogram/pages/session/session.js');
  let definition; const calls = [], pickers = [], reads = [];
  const groups = [{ id: 'commands', items }];
  const store = { state: { connection: 'connected', activeID: 'host1', currentWorkspaceId: 'w1' }, sessionState: { sessionId: 's1', commandGroups: groups, commandOptions: [], running: false },
    appendLocalUserRow: (...args) => calls.push(['echo', ...args]), selectModel: async (...args) => { calls.push(['model', ...args]); }, client: { connectGeneration: 1,
      requestCommands: async id => { calls.push(['commands', id]); return { groups }; },
      requestCommandOptions: async (id, name) => { calls.push(['options', id, name]); return { options: [{ id: 'one', label: 'First', selected: true }, { id: 'two', label: 'Second' }] }; },
      selectCommandOption: async (...args) => { calls.push(['select', ...args]); },
      setPermission: async (...args) => { calls.push(['permission', ...args]); },
      executeCommand: async (...args) => { calls.push(['execute', ...args]); },
      sendMessage: (...args) => { calls.push(['send', ...args]); return true; },
      requestFileList: async () => ({ path: '.', entries: [{ name: 'a b.js', path: 'src/a b.js', kind: 'file' }] })
    } };
  const wx = { hideKeyboard() {}, showToast: data => calls.push(['toast', data.title]),
    chooseMedia: options => pickers.push(options), chooseMessageFile: options => pickers.push(options),
    getImageInfo: options => options.success({ type: 'png' }), previewImage: options => calls.push(['preview', options]),
    getFileSystemManager: () => ({ readFile: options => reads.push(options) }) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: value => { definition = value; }, wx, console, setTimeout, clearTimeout,
    require: name => name.endsWith('/store') ? store : require(path.resolve(path.dirname(file), name)) });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let target = this.data;
      parts.slice(0, -1).forEach((part, i) => { if (target[part] == null) target[part] = /^\d+$/.test(parts[i + 1]) ? [] : {}; target = target[part]; });
      target[parts.at(-1)] = value;
    }
  }, updateDockInset() {}, prioritizeInteraction() {}, refreshBottomAnchor() {}, rememberQueuedSubmission: (...args) => calls.push(['queue', ...args]) };
  return { page, store, calls, pickers, reads, wx };
}
test('plus opens commands without inserting slash or clearing draft and attachments', async () => {
  const { page, calls } = fixture(); page.data.draft = 'unfinished'; page.data.images = [{ id: 'keep' }];
  await page.attachMenu(); assert.equal(page.data.draft, 'unfinished'); assert.equal(page.data.images[0].id, 'keep');
  assert.equal(page.data.commandMenu.type, 'catalog'); assert.ok(calls.some(x => x[0] === 'commands'));
  page.attachMenu(); assert.equal(page.data.commandMenu, null); assert.equal(page.data.draft, 'unfinished');
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
  assert.equal(page.data.commandMenu.type, 'catalog'); assert.ok(!page.data.commandMenu.groups.flatMap(x => x.items).some(x => x.action === 'file'));
  page.closeAttachMenu(); page.onDraftInput({ detail: { value: '/compact', cursor: 8 } });
  assert.equal(page.data.commandMenu.groups[0].items[0].name, 'compact');
  page.closeAttachMenu(); page.syncCommandMenu('/compact', { commandGroups: [{ items: [command('compact')] }] }); assert.equal(page.data.commandMenu, null);
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
  assert.equal(page.data.draft, 'Read @"src/a b.js" '); assert.equal(page.data.filesSheetOpen, false);
  const pending = deferred(); store.client.requestFileList = () => pending.promise; page.openFilesSheet(true); page.closeFilesSheet();
  pending.resolve({ entries: [{ name: 'late', path: 'late', kind: 'file' }] }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.filesEntries.length, 0);
});
test('image picker detects MIME, previews originals, enforces size and never uploads PDFs as images', async () => {
  const { page, pickers, calls } = fixture(); page.chooseImage();
  await pickers[0].success({ tempFiles: [{ tempFilePath: '/tmp/photo', size: 42 }, { tempFilePath: '/tmp/huge', size: 9 * 1024 * 1024 }] });
  assert.equal(page.data.images.length, 1); assert.equal(page.data.images[0].mediaType, 'image/png');
  page.previewPendingImage(event({ index: 0 })); assert.ok(calls.some(x => x[0] === 'preview'));
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
test('normal image messages use immediate mode; running sessions explicitly queue', async () => {
  const { page, store, calls, reads } = fixture(); page.data.draft = 'image task'; page.data.images = [{ id: 'i', tempPath: '/tmp/i', mediaType: 'image/png', name: 'i.png' }];
  const pending = page.send(); reads[0].success({ data: 'aGVsbG8=' }); await pending;
  const sent = calls.find(x => x[0] === 'send'); assert.equal(sent[5], undefined); assert.equal(sent[4][0].mediaType, 'image/png'); assert.equal(page.data.draft, '');
  store.sessionState.running = true; page.data.draft = 'next'; await page.send(); assert.equal(calls.filter(x => x[0] === 'send').at(-1)[5], 'queue');
});
test('successful send resets an old scroll gesture and immediately follows the tail', async () => {
  const {page,store}=fixture();let scrolls=0;page.refreshBottomAnchor=()=>scrolls++;
  page._convPinned=false;page._lastTouchAt=Date.now();page.data.showJump=true;page.data.draft='new task';
  await page.send();
  assert.equal(page._convPinned,true);assert.equal(page._lastTouchAt,0);assert.equal(page.data.showJump,false);assert.equal(scrolls,1);
  page._convPinned=false;page.data.draft='retry';store.client.sendMessage=()=>false;await page.send();
  assert.equal(page._convPinned,false);assert.equal(scrolls,1);assert.equal(page.data.draft,'retry');
});
const compiler = process.env.WECHAT_WCC || 'D:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe';
test('native WXML renders the plus menu, attachments, choices and blocked-attachment plus in both themes', { skip: !fs.existsSync(compiler) }, () => {
  const root = path.resolve(__dirname, '../miniprogram'), output = path.join(os.tmpdir(), 'dsh-composer-' + process.pid + '.js');
  try {
    execFileSync(compiler, ['-o', output, 'pages/session/session.wxml'], { cwd: root });
    const context = vm.createContext({ window: {}, console }); vm.runInContext(fs.readFileSync(output, 'utf8'), context); const render = context.$gwx('pages/session/session.wxml');
    for (const theme of ['light', 'dark']) for (const type of ['catalog', 'attachments', 'options']) {
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
      }
      if (type === 'attachments') {
        assert.ok(tree.includes('工作区文件'));
        const chatImages = rows.find(row => row.attr.bindtap === 'chooseFile');
        assert.equal(chatImages.children[0].children[0].attr.src, '/assets/icons/menu-chat-image.svg');
        assert.equal(rows.find(row => row.attr.bindtap === 'chooseImage').children[0].children[0].attr.src, '/assets/icons/menu-image.svg');
        assert.equal(rows[0].attr.bindtap, 'backToComposerCommands');
        assert.ok(hasClass(rows[0], 'command-menu-return'));
        assert.equal(rows.find(row => row.attr.bindtap === 'chooseWorkspaceReference').children[0].children[0].attr.src, '/assets/icons/menu-folder.svg');
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
    '.command-attachments.command-menu-toolbar{padding:0;gap:0}',
    '.command-check-slot{width:14px;height:18px;flex:0014px;margin-left:auto;',
    '.command-options.command-option,.command-options-return{min-height:44px}',
    '.opt-pop.permission-pop.opt-row:hover{background:var(--fill-2)}',
    '.opt-pop.permission-pop.opt-row{min-height:44px}',
    '.model-pop.model-row:hover,.model-chip:hover{background:var(--fill-2)}',
    '.model-pop.model-row{min-height:44px}',
    '.model-entry-value{flex:1;min-width:0;display:flex;align-items:center;justify-content:flex-end;'
  ]) assert.ok(css.includes(rule), rule);
});
