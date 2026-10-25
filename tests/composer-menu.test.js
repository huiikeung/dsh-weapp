const test = require('node:test');
const assert = require('node:assert/strict');
const menu = require('../miniprogram/utils/composer-menu');
const item = (name, kind = 'immediate', source = 'host') => ({ id: source + ':' + name, name, source, description: name, ui: { kind, submitRequest: 'command-execute' } });
const groups = [{ id: 'commands', items: [item('export'), item('goal', 'input'), item('model', 'select'), item('compact'), item('plan', 'input'), item('feedback', 'input'), item('permission', 'select')] }, { id: 'skills', items: [item('goal', 'input', 'skill')] }];
test('plus follows desktop Add and Commands order without inventing host actions', () => {
  const result = menu.catalog(groups, { t: x => x });
  assert.deepEqual(result[0].items.map(x => x.name), ['image', 'chatImage', 'workspace', 'chatFile', 'goal', 'plan', 'feedback']);
  assert.deepEqual(result[1].items.map(x => x.name), ['compact', 'permission', 'model', 'export']);
  assert.equal(result[2].items[0].label, '/goal');
  const empty = menu.catalog([], { t: x => x })[0].items;
  assert.deepEqual(empty.map(x => x.name), ['image', 'chatImage', 'workspace', 'chatFile']);
  assert.deepEqual(empty.map(x => x.action), ['image', 'chatImage', 'workspace', 'chatFile']);
  assert.deepEqual(empty.map(x => x.icon), ['menu-image.svg', 'menu-chat-image.svg', 'menu-folder.svg', 'menu-chat-file.svg']);
  assert.deepEqual(empty.map(x => x.label), ['添加图片', '聊天中的图片', '工作区文件', '聊天中的文件']);
});
test('model display uses catalog names and limits the desktop 1017 badge to official Flash', () => {
  const catalog = { groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }] }, { id: 'custom', models: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }] }] };
  assert.deepEqual(menu.modelFace(catalog, { provider: 'deepseek-official', model: 'deepseek-flash' }), { label: 'DeepSeek-V4.1-Flash', badge: '1017' });
  assert.equal(menu.modelFace(catalog, { provider: 'custom', model: 'deepseek-flash' }).badge, '');
  assert.deepEqual(menu.modelFace(null, { model: 'user-model' }), { label: 'user-model', badge: '' });
  assert.deepEqual(menu.modelFace(null, null), { label: '', badge: '' });
});
test('menu searches localized names and respects inline and attachment availability', () => {
  assert.equal(menu.catalog(groups, { t: x => x, query: '压缩' })[0].items[0].name, 'compact');
  const rows = menu.catalog(groups, { t: x => x, leading: false, canAttach: false }).flatMap(x => x.items);
  assert.ok(!rows.some(x => ['goal', 'plan', 'feedback', 'image', 'chatImage', 'workspace', 'chatFile'].includes(x.name)));
  assert.deepEqual(menu.catalog(groups, { t: x => x, query: '相册' })[0].items.map(x => x.name), ['image', 'chatImage']);
  assert.equal(menu.acceptsAttachments(item('goal', 'input')), false);
  assert.equal(menu.acceptsAttachments({ input: { attachments: true } }), true);
});
test('input commands preserve content, file references quote spaces and images keep their MIME type', () => {
  assert.equal(menu.inputDraft(item('goal', 'input'), 'keep my draft'), '/goal keep my draft');
  assert.equal(menu.inputDraft(item('plan', 'input'), '/go some work'), '/plan some work');
  assert.equal(menu.fileReference('src/a b.js'), '@"src/a b.js"');
  assert.equal(menu.fileReference('src/a\nb.js'), '');
  assert.equal(menu.sessionReference('session-中文', '标题]测试\\'), '@[标题\\]测试\\\\](dsh-session:' + require('../miniprogram/utils/util').encodeBase64URL(JSON.stringify('session-中文')) + ')');
  assert.equal(menu.imageType('photo.PNG'), 'image/png');
  assert.equal(menu.imageType('report.pdf'), '');
});
test('@ references are tracked at the cursor and preserve quoted paths while drilling', () => {
  assert.deepEqual(menu.referenceAtCursor('Read @src/fi.js now', 12), { start: 5, end: 15, query: 'src/fi', quoted: false });
  assert.deepEqual(menu.referenceAtCursor('Read @"src/my file.js"', 16), { start: 5, end: 22, query: 'src/my fi', quoted: true });
  assert.deepEqual(menu.referenceAtCursor('mail@host', 9), null);
  assert.deepEqual(menu.referenceAtCursor('Read @src/file ', 15), null);
  assert.equal(menu.fileReferencePrefix('src/my folder/', true), '@"src/my folder/');
});
test('permission options use desktop Chinese labels while preserving ids, custom names and model names', () => {
  const options = [
    { id: 'read-only', label: 'Read Only' }, { id: 'workspace-write', label: 'Workspace Write' },
    { id: 'danger-full-access', label: 'Full access', active: true }, { id: 'auto', label: 'Auto review', detail: 'English host fallback' },
    { id: 'custom-read-only', label: 'Company custom', detail: 'Company policy' }
  ];
  const rows = menu.optionRows('permission', options, { t: x => x });
  assert.deepEqual(rows.map(row => row.label), ['仅可查看', '工作区内修改', '完全权限', '自动审查', 'Company custom']);
  assert.deepEqual(rows.map(row => row.id), options.map(option => option.id));
  assert.equal(rows[2].selected, true); assert.equal(rows[3].badge, 'EXP');
  assert.match(rows[3].detail, /^无沙箱运行；/); assert.equal(rows[4].detail, 'Company policy');
  assert.equal(menu.optionRows('permission', options, { t: x => x, query: '工作区' })[0].id, 'workspace-write');
  assert.equal(menu.optionRows('permission', options, { t: x => x, query: 'Workspace Write' })[0].id, 'workspace-write');
  assert.equal(menu.optionRows('model', [{ id: 'auto', label: 'Model auto' }], { t: x => x })[0].label, 'Model auto');
  assert.equal(menu.optionTitle('permission', x => x), '权限');
  assert.equal(menu.optionTitle('model', x => x), '模型');
  const dictionary = require('../resources/i18n/interface.json');
  const english = menu.optionRows('permission', options, { t: x => dictionary[x] || x });
  assert.deepEqual(english.slice(0, 4).map(row => row.label), ['Read Only', 'Workspace Write', 'Full access', 'Auto review']);
  assert.match(english[3].detail, /^Run without a sandbox/);
});

test('slash-command presentation splits token from argument and labels input commands', () => {
  const commands = [
    { name: 'goal', source: 'host', ui: { kind: 'input' } },
    { name: 'plan', source: 'host', ui: { kind: 'input', insertText: '/plan ' } },
    { name: 'compact', source: 'host', ui: { kind: 'immediate' } },
    { name: 'review-pr', source: 'skill', ui: { kind: 'input', insertText: '/review-pr ' } }
  ];
  assert.deepEqual(menu.presentation('/goal ', commands), { command: commands[0], token: '/goal', argument: '' });
  assert.equal(menu.presentation('/goal 写报告', commands).argument, '写报告');
  assert.equal(menu.presentation('/goal写', commands), null, 'token must end at whitespace');
  assert.equal(menu.presentation('/compact', commands), null, 'immediate commands carry no token');
  assert.equal(menu.presentation('/review-pr 检查', commands).token, '/review-pr');
  assert.equal(menu.presentation('hello', commands), null);
  const t = key => ({ 目标: 'Goal', 计划: 'Plan' })[key] || key;
  assert.equal(menu.commandLabel(commands[0], t), '/Goal', 'localized label keeps the slash');
  assert.equal(menu.commandLabel(commands[3], t), '/review-pr', 'skills keep their own name');
});
