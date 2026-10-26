const test = require('node:test');
const assert = require('node:assert/strict');
const markdown = require('../miniprogram/utils/markdown');

test('standalone markdown image becomes an image block', () => {
  const blocks = markdown.parse('![新旧对比](assets/promo/share-cover-compare.png)');
  assert.deepEqual(blocks, [{ type: 'image', alt: '新旧对比', src: 'assets/promo/share-cover-compare.png' }]);
});

test('several images on one line keep their order', () => {
  const blocks = markdown.parse('![a](a.png) ![b](b.jpg)');
  assert.deepEqual(blocks.map((block) => block.src), ['a.png', 'b.jpg']);
  assert.equal(blocks[0].alt, 'a');
});

test('images next to other markdown keep their own blocks', () => {
  const blocks = markdown.parse('# 标题\n\n![图](https://example.com/x.png)\n\n正文');
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'image');
  assert.equal(blocks[1].src, 'https://example.com/x.png');
  assert.equal(blocks[2].type, 'para');
});

test('inline images do not leave a stray exclamation mark', () => {
  const blocks = markdown.parse('文字 ![图](b.png) 结束');
  const html = blocks[0].html;
  assert.equal(html.includes('!['), false);
  assert.equal(html.includes('>图</a>'), true);
  assert.equal(html.includes('href="b.png"'), true);
});

test('image state preparation marks remote and data URIs without downloading', () => {
  const mixin = require('../miniprogram/pages/session/image-blocks');
  const queued = [];
  const ctx = {
    ...mixin,
    queueMarkdownImage(src) { queued.push(src); },
    _mdImageSession: null
  };
  const blocks = [
    { type: 'image', src: 'https://example.com/a.png' },
    { type: 'image', src: 'data:image/png;base64,AAAA' },
    { type: 'image', src: 'assets/promo/a.png' },
    { type: 'para', html: 'x' }
  ];
  ctx.prepareImageBlocks(blocks);
  assert.equal(blocks[0].imageState, 'remote');
  assert.equal(blocks[1].imageState, 'remote');
  assert.equal(blocks[2].imageState, 'pending');
  assert.deepEqual(queued, ['assets/promo/a.png']);
});

test('image state preparation is idempotent for resolved blocks', () => {
  const mixin = require('../miniprogram/pages/session/image-blocks');
  const queued = [];
  const ctx = {
    ...mixin,
    queueMarkdownImage(src) { queued.push(src); },
    _mdImageSession: null
  };
  const blocks = [{ type: 'image', src: 'assets/promo/a.png' }];
  ctx.prepareImageBlocks(blocks);
  const again = [{ type: 'image', src: 'assets/promo/a.png', imageState: 'local', localPath: '/tmp/a.png' }];
  ctx.prepareImageBlocks(again);
  assert.equal(queued.length, 1);
  assert.equal(again[0].imageState, 'local');
});

test('relative workspace image is downloaded once and patched into the row', async () => {
  const fileDownloadPath = require.resolve('../miniprogram/pages/session/utils/file-download');
  const mixinPath = require.resolve('../miniprogram/pages/session/image-blocks');
  const fileDownload = require(fileDownloadPath);
  const store = require('../miniprogram/utils/store');
  const originalDownload = fileDownload.downloadFile;
  const originalRemove = fileDownload.removeFile;
  const previousSession = store.sessionState.sessionId;
  const previousCwd = store.sessionState.cwd;
  const downloads = [];
  fileDownload.downloadFile = async (_client, file) => { downloads.push(file.path); return { localPath: '/tmp/md-image.png' }; };
  fileDownload.removeFile = async () => {};
  delete require.cache[mixinPath];
  try {
    store.sessionState.sessionId = 'session-images';
    store.sessionState.cwd = '/workspace';
    const mixin = require(mixinPath);
    const patches = [];
    const page = Object.assign({}, mixin, {
      _unloaded: false,
      data: { rows: [{ key: 'row-1', blocks: [{ type: 'image', src: 'assets/promo/a.png' }] }] },
      setData(patch) { patches.push(patch); }
    });
    page.prepareImageBlocks(page.data.rows[0].blocks);
    assert.equal(page.data.rows[0].blocks[0].imageState, 'pending');
    for (let i = 0; i < 40 && !patches.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(downloads, ['assets/promo/a.png']);
    assert.equal(page.data.rows[0].blocks[0].imageState, 'local');
    assert.equal(page.data.rows[0].blocks[0].localPath, '/tmp/md-image.png');
    assert.ok(patches.some((patch) => patch['rows[0].blocks[0].localPath'] === '/tmp/md-image.png'));
  } finally {
    fileDownload.downloadFile = originalDownload;
    fileDownload.removeFile = originalRemove;
    delete require.cache[mixinPath];
    store.sessionState.sessionId = previousSession;
    store.sessionState.cwd = previousCwd;
  }
});

test('history prefetch downloads images early and reuses the persisted index', async () => {
  const fileDownloadPath = require.resolve('../miniprogram/pages/session/utils/file-download');
  const mixinPath = require.resolve('../miniprogram/pages/session/image-blocks');
  const fileDownload = require(fileDownloadPath);
  const store = require('../miniprogram/utils/store');
  const originalDownload = fileDownload.downloadFile;
  const previousSession = store.sessionState.sessionId;
  const previousCwd = store.sessionState.cwd;
  const storage = {};
  const files = new Set(['/tmp/cached.png']);
  const previousWx = global.wx;
  const downloads = [];
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    getFileSystemManager: () => ({
      accessSync: (path) => { if (!files.has(path)) throw new Error('missing'); },
      unlink: () => {}
    })
  };
  fileDownload.downloadFile = async (_client, file) => { downloads.push(file.path); return { localPath: '/tmp/cached.png' }; };
  delete require.cache[mixinPath];
  try {
    store.sessionState.sessionId = 'session-prefetch';
    store.sessionState.cwd = '/workspace';
    const mixin = require(mixinPath);
    const page = Object.assign({}, mixin, { _unloaded: false, data: { rows: [] }, setData() {} });
    page.prefetchImageMarkdown([{ kind: 'assistant', text: '结果：\n![图](assets/promo/a.png)\n' }]);
    for (let i = 0; i < 40 && !downloads.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    for (let i = 0; i < 40 && !page.readImageIndexEntry('session-prefetch|assets/promo/a.png'); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(downloads, ['assets/promo/a.png']);
    const entry = page.readImageIndexEntry('session-prefetch|assets/promo/a.png');
    assert.equal(entry.path, '/tmp/cached.png');
    assert.ok(storage['dsh.mdImage.index.v1']);
    // 同一张图再次渲染：走索引，不再下载。
    const blocks = [{ type: 'image', src: 'assets/promo/a.png' }];
    page._mdImageSession = 'session-prefetch';
    page.prepareImageBlocks(blocks);
    assert.equal(blocks[0].imageState, 'local');
    assert.equal(blocks[0].localPath, '/tmp/cached.png');
    assert.deepEqual(downloads, ['assets/promo/a.png']);
  } finally {
    fileDownload.downloadFile = originalDownload;
    delete require.cache[mixinPath];
    store.sessionState.sessionId = previousSession;
    store.sessionState.cwd = previousCwd;
    if (previousWx === undefined) delete global.wx; else global.wx = previousWx;
  }
});

test('composer markdown covers the constructs a chat draft uses', () => {
  const cases = [
    ['**粗体** 与 `代码`', (b) => b[0].type === 'para' && b[0].html.includes('<strong>') && b[0].html.includes('<code')],
    ['# 标题一', (b) => b[0].type === 'heading' && b[0].level === 1],
    ['## 标题二', (b) => b[0].type === 'heading' && b[0].level === 2],
    ['- 甲\n- 乙', (b) => b[0].type === 'list' && !b[0].ordered && b[0].items.length === 2],
    ['1. 甲\n2. 乙', (b) => b[0].type === 'list' && b[0].ordered && b[0].items.length === 2],
    ['> 引用一句', (b) => b[0].type === 'quote'],
    ['```js\nconst a = 1;\n```', (b) => b[0].type === 'code' && b[0].lang === 'js' && b[0].text === 'const a = 1;'],
    ['| 名称 | 数量 |\n|---|---|\n| 读取 | 3 |', (b) => b[0].type === 'table' && b[0].header.length === 2 && b[0].rows[0][1] === '3'],
    ['---', (b) => b[0].type === 'hr'],
    ['第一段\n\n第二段', (b) => b.length === 2 && b.every((block) => block.type === 'para')],
  ];
  for (const [text, check] of cases) {
    const blocks = markdown.parse(text);
    assert.ok(check(blocks), text.slice(0, 24) + ' -> ' + JSON.stringify(blocks).slice(0, 120));
  }
});

test('a plain one-line draft stays a single paragraph so the bubble look is unchanged', () => {
  const blocks = markdown.parse('帮我查一下 GLM-5.3');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'para');
  assert.ok(blocks[0].html.includes('GLM-5.3'));
  assert.ok(!blocks[0].html.includes('&lt;'), 'plain text is not escaped into visible tags');
});
