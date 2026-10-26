const test = require('node:test');
const assert = require('node:assert/strict');
const menu = require('../miniprogram/pages/session/utils/composer-menu');
const util = require('../miniprogram/utils/util');

const P = menu.REF_PLACEHOLDER;
const sessionRef = (id, label) => menu.sessionReference(id, label);

test('session, quoted file and bare folder references round-trip between draft and display', () => {
  const draft = '看看 ' + sessionRef('s1', '标题]转义') + ' 和 @"src/a b.js" 还有 @licenses/ 好吗';
  const { display, refs } = menu.referencesToDisplay(draft);
  assert.deepEqual(refs.map(ref => [ref.kind, ref.label]), [
    ['session', '标题]转义'], ['file', 'src/a b.js'], ['folder', 'licenses/']
  ]);
  assert.equal(display, '看看 ' + P + ' 和 ' + P + ' 还有 ' + P + ' 好吗');
  assert.equal(menu.displayToDraft(display, refs), draft, 'display + refs rebuild the exact draft');
  assert.deepEqual(menu.referenceChips(refs).map(ref => ref.icon),
    ['menu-chat-session-blue.svg', 'menu-chat-file-blue.svg', 'menu-folder-blue.svg']);
});

test('plain text without references stays untouched and literal @ is not a reference', () => {
  assert.deepEqual(menu.parseReferences('mail@host.com and @ at end'), { segments: ['mail@host.com and @ at end'], refs: [] });
  assert.equal(menu.referencesToDisplay('hello').display, 'hello');
  assert.equal(menu.displayToDraft('hello', []), 'hello');
  // 不完整形态（手打到一半的引用）保持字面文本，交给 @ 菜单继续编辑。
  const partial = menu.referencesToDisplay('@[标题](dsh-session:abc');
  assert.deepEqual(partial.refs, []);
  assert.equal(partial.display, '@[标题](dsh-session:abc');
});

test('edits around placeholders keep chips aligned with the draft', () => {
  const draft = 'A ' + sessionRef('s1', 'one') + ' B ' + sessionRef('s2', 'two') + ' C';
  const { display, refs } = menu.referencesToDisplay(draft);
  // 在文本中间插入字符：chips 不动，草稿同步长
  const typed = menu.applyDisplayEdit(display, display.slice(0, 2) + 'X' + display.slice(2), refs);
  assert.equal(typed.refs.length, 2);
  assert.equal(menu.displayToDraft(typed.display, typed.refs), 'A X' + sessionRef('s1', 'one') + ' B ' + sessionRef('s2', 'two') + ' C');
  // 删掉第一个占位符：对应 chip 消失，草稿里引用文本一并消失
  const placeholderAt = display.indexOf(P);
  const deleted = menu.applyDisplayEdit(display, display.slice(0, placeholderAt) + display.slice(placeholderAt + 1), refs);
  assert.deepEqual(deleted.refs.map(ref => ref.label), ['two']);
  assert.equal(menu.displayToDraft(deleted.display, deleted.refs), 'A  B ' + sessionRef('s2', 'two') + ' C');
  // 选区跨占位符替换：被圈住的引用整体移除
  const replaced = menu.applyDisplayEdit(display, display.slice(0, 2) + 'X' + display.slice(4), refs);
  assert.deepEqual(replaced.refs.map(ref => ref.label), ['two']);
  assert.equal(menu.displayToDraft(replaced.display, replaced.refs), 'A XB ' + sessionRef('s2', 'two') + ' C');
  // 误入编辑区间的零宽字符被清掉，不错位
  const stray = menu.applyDisplayEdit(display, display.slice(0, 4) + P + display.slice(4), refs);
  assert.equal(stray.display, display);
  assert.equal(stray.refs.length, 2);
});

test('referenceAtCursor treats the placeholder as a token boundary', () => {
  const { display } = menu.referencesToDisplay('看看 ' + sessionRef('s1', 'one') + ' 后面');
  assert.deepEqual(menu.referenceAtCursor(display, display.length), null, 'plain text after a chip opens no menu');
  const typing = display + ' @re';
  assert.deepEqual(menu.referenceAtCursor(typing, typing.length), { start: display.length + 1, end: typing.length, query: 're', quoted: false });
  // chip 紧贴光标时也能新开引用（占位符与空白一样切断查询）
  assert.deepEqual(menu.referenceAtCursor(P + '@x', 3), { start: 1, end: 3, query: 'x', quoted: false });
  assert.deepEqual(menu.referenceAtCursor('mail@host', 9), null);
});

test('session reference labels unescape brackets and backslashes', () => {
  // 线格式里 ] 与 \ 被转义；解析出的标题还原成用户看到的原文。
  const label = 'a\\]b\\\\c';
  const raw = sessionRef('s1', label);
  const { refs } = menu.referencesToDisplay(raw);
  assert.equal(refs[0].label, label);
  assert.equal(refs[0].raw, raw);
  const decoded = util.decodeBase64URL(refs[0].raw.slice(refs[0].raw.indexOf('dsh-session:') + 'dsh-session:'.length, -1));
  assert.equal(JSON.parse(decoded), 's1');
});

test('adjacent references without whitespace between them each become their own chip', () => {
  // 连续选两个引用时中间没有空格，草稿里是 @a@b：必须解析成两个 chip，
  // 否则第二个引用会粘进第一个 token、退化成原始文本。
  const folder = menu.fileReference('licenses/');
  const session = sessionRef('s1', '分析参考项目额度页结构');
  const file = menu.fileReference('logo_src2.jpg');
  for (const [first, second] of [[folder, session], [file, menu.fileReference('approval-test.txt')], [session, folder]]) {
    const glued = first + second;
    const { display, refs } = menu.referencesToDisplay(glued);
    assert.equal(refs.length, 2, glued);
    assert.equal(display, P + P);
    assert.equal(menu.displayToDraft(display, refs), glued, 'round-trip keeps both raw references');
  }
  // 三个相邻、以及文本包住相邻引用
  const three = folder + session + file;
  const parsedThree = menu.referencesToDisplay(three);
  assert.equal(parsedThree.refs.length, 3);
  assert.equal(menu.displayToDraft(parsedThree.display, parsedThree.refs), three);
  const mixed = '看 ' + folder + session + ' 谢谢';
  const parsedMixed = menu.referencesToDisplay(mixed);
  assert.equal(parsedMixed.refs.length, 2);
  assert.equal(parsedMixed.display, '看 ' + P + P + ' 谢谢');
  assert.equal(menu.displayToDraft(parsedMixed.display, parsedMixed.refs), mixed);
  // 普通 @ 紧跟字符（邮箱等）仍然按字面文本处理
  assert.deepEqual(menu.parseReferences('mail@host.com').refs, []);
});
