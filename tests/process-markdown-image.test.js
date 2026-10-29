const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const imageBlocks = require('../miniprogram/pages/session/image-blocks');

test('markdown images inside process narration settle and preview from their nested block list', () => {
  const image = { type: 'image', src: 'workspace/result.png', imageState: 'pending' };
  const page = Object.assign({}, imageBlocks, {
    data: { rows: [{ kind: 'processGroup', key: 'group', children: [{ kind: 'narration', key: 'narration', blocks: [image] }] }] },
    patches: [],
    setData(patch) { this.patches.push(patch); }
  });
  page.applyMarkdownImageState('workspace/result.png', { imageState: 'local', localPath: '/tmp/result.png' });
  assert.equal(image.imageState, 'local');
  assert.equal(image.localPath, '/tmp/result.png');
  assert.deepEqual(page.patches[0], {
    'rows[0].children[0].blocks[0].imageState': 'local',
    'rows[0].children[0].blocks[0].localPath': '/tmp/result.png'
  });

  let preview;
  global.wx = { previewImage(value) { preview = value; } };
  try {
    page.previewMarkdownImage({ currentTarget: { dataset: { key: 'narration', src: '/tmp/result.png' } } });
    assert.deepEqual(preview, { current: '/tmp/result.png', urls: ['/tmp/result.png'] });
  } finally {
    delete global.wx;
  }
});

test('process narration aligns with the left edge of its parent work-step group', () => {
  for (const base of ['../resources/runtime-markup/pages/session/session.wxss', '../miniprogram/pages/session/session.wxss']) {
    const css = fs.readFileSync(path.join(__dirname, base), 'utf8');
    assert.match(css, /\.process-narration \{[^}]*margin:4rpx 0 16rpx;/);
    assert.doesNotMatch(css, /\.process-narration \{[^}]*margin:[^;}]*44rpx/);
  }
});

test('markdown preview includes every image in the message, downloaded or not', () => {
  const blocks = [
    { type: 'image', src: 'a.png', imageState: 'local', localPath: '/tmp/a.png' },
    { type: 'image', src: 'https://host/b.png', imageState: 'remote' },
    { type: 'image', src: 'c.png', imageState: 'pending' }
  ];
  const page = Object.assign({}, imageBlocks, {
    data: { rows: [{ kind: 'assistant', key: 'row-1', blocks }] }
  });
  let preview;
  global.wx = { previewImage(value) { preview = value; } };
  try {
    page.previewMarkdownImage({ currentTarget: { dataset: { key: 'row-1', src: '/tmp/a.png' } } });
    assert.deepEqual(preview.urls, ['/tmp/a.png', 'https://host/b.png', 'c.png']);
    assert.equal(preview.current, '/tmp/a.png');
  } finally {
    delete global.wx;
  }
});
