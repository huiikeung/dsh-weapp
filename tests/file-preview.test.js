const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, formatBytes } = require('../miniprogram/pages/session/utils/file-deliverables');
const { openSheet, reveal, primaryLabel, readLocalText, openDocumentType }
  = require('../miniprogram/pages/session/utils/file-preview');
const { describe } = require('../miniprogram/pages/session/utils/file-deliverables');

test('classify maps extensions to a sheet kind, icon and preview strategy', () => {
  assert.deepEqual(classify('pdf'), { kind: 'pdf', previewKind: 'document', sourceCode: false });
  assert.equal(classify('docx').kind, 'document');
  assert.equal(classify('xlsx').kind, 'table');
  assert.equal(classify('pptx').kind, 'slides');
  assert.equal(classify('webp').previewKind, 'image');
  assert.equal(classify('html').sourceCode, true, 'html is shown as inert source');
  assert.equal(classify('js').previewKind, 'text');
  assert.equal(classify('zip').previewKind, 'file');
  assert.equal(classify('').kind, 'file');
  // md/txt 仍按文档图标展示（沿用交付卡片的口径），但正文按文本预览。
  assert.equal(classify('md').kind, 'document');
  assert.equal(classify('md').previewKind, 'text');
  assert.equal(classify('csv').kind, 'table');
  assert.equal(classify('csv').previewKind, 'text');
});

test('describe normalizes every entry point into one sheet descriptor', () => {
  const composer = describe({ id: 'a1', isFile: true, tempPath: 'wxfile://tmp/x', name: '合同.pdf', size: 2048 });
  assert.equal(composer.key, 'a1');
  assert.equal(composer.localPath, 'wxfile://tmp/x');
  assert.equal(composer.previewKind, 'document');
  assert.equal(composer.typeLabel, 'PDF');
  assert.equal(composer.sizeLabel, '2.0 KB');
  assert.equal(composer.icon, '/assets/icons/deliverable-pdf.svg');
  assert.equal(composer.canCopyPath, false, 'a staged temp file has no workspace path to copy');

  const delivered = describe({ key: 'f1', sessionId: 's1', path: 'docs/a.md', size: 10 });
  assert.equal(delivered.name, 'a.md');
  assert.equal(delivered.previewKind, 'text');
  assert.equal(delivered.canCopyPath, true);
  assert.equal(delivered.typeLabel, 'Markdown');
});

test('openSheet tags where the file came from and stays idle for gateway files', () => {
  assert.equal(openSheet({ name: 'a.png', tempPath: 'wxfile://tmp/a' }, { origin: 'composer' }).origin, 'composer');
  const remote = openSheet({ sessionId: 's', path: 'docs/a.pdf', name: 'a.pdf' }, { origin: 'delivered' });
  assert.equal(remote.origin, 'delivered');
  assert.equal(remote.localPath, '');
  assert.equal(remote.primary, '用微信打开', 'documents never pre-download; WeChat opens the body');
  assert.equal(remote.canShare, false);
});

test('primaryLabel switches to copy and full-screen view once bytes are local', () => {
  assert.equal(primaryLabel('text', false), '预览文件');
  assert.equal(primaryLabel('text', true), '复制');
  assert.equal(primaryLabel('image', false), '预览文件');
  assert.equal(primaryLabel('image', true), '查看原图');
  assert.equal(primaryLabel('document', false), '用微信打开');
  assert.equal(primaryLabel('file', true), '转发到微信');
});

test('reveal fills the readable state after a download', () => {
  const file = describe({ sessionId: 's', path: 'docs/a.md', name: 'a.md', size: 4 });
  const ready = reveal(file, { localPath: 'D:/tmp/a.md', size: 4096 });
  assert.equal(ready.localPath, 'D:/tmp/a.md');
  assert.equal(ready.sizeLabel, '4.0 KB');
  assert.equal(ready.primary, '复制');
  assert.equal(ready.text, '');
  assert.equal(ready.error, '');
});

test('formatBytes renders human sizes and stays empty for unknown ones', () => {
  assert.equal(formatBytes(0), '');
  assert.equal(formatBytes(undefined), '');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(1024 * 1024 * 3), '3.0 MB');
});

test('openDocumentType only passes the file types WeChat accepts', () => {
  assert.equal(openDocumentType('pdf'), 'pdf');
  assert.equal(openDocumentType('docx'), 'docx');
  assert.equal(openDocumentType('xlsx'), 'xlsx');
  assert.equal(openDocumentType('zip'), '');
  assert.equal(openDocumentType('md'), '');
});

test('readLocalText reads a bounded prefix and reports truncation', async () => {
  const reads = [];
  const api = { getFileSystemManager: () => ({ readFile: (options) => { reads.push(options); options.success({ data: 'hello' }); } }) };
  const small = await readLocalText(api, 'D:/tmp/a.txt', 5);
  assert.equal(small.text, 'hello');
  assert.equal(small.truncated, false);
  assert.equal(reads[0].length, 5);

  const empty = await readLocalText(api, 'D:/tmp/empty.txt', 0);
  assert.deepEqual(empty, { text: '', truncated: false });

  const big = await readLocalText(api, 'D:/tmp/big.txt', 128 * 1024 + 1);
  assert.equal(big.truncated, true);
  assert.equal(big.text, 'hello');
});
