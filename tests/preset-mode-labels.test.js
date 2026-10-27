const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const labels = require('../miniprogram/utils/labels');

test('every known preset mode label keeps the 模式 suffix and uppercase acronyms', () => {
  assert.equal(labels.presetModeName('standard'), '标准模式');
  assert.equal(labels.presetModeName('code'), 'PTC 模式');
  // ptc 是 PTC 模式的另一个 id：不能回落成原始小写 id，也不能丢掉「模式」
  assert.equal(labels.presetModeName('ptc'), 'PTC 模式');
  assert.equal(labels.presetModeName('minimal'), '极简模式');
  assert.equal(labels.presetModeName('cordis'), '创造模式');
  // 未知 id 也带「模式」后缀，chip 里不会出现光秃秃的 id
  assert.equal(labels.presetModeName('my-custom-agent'), 'my-custom-agent 模式');
  // ptc 的描述与 code 一致（此前误把名字当描述）
  assert.equal(labels.presetModeDesc('ptc'), labels.presetModeDesc('code'));
});

test('gateway names that merely echo the preset id fall back to the localized label', () => {
  assert.equal(labels.presetDisplayName('ptc', 'ptc'), 'PTC 模式');
  assert.equal(labels.presetDisplayName('PTC', 'ptc'), 'PTC 模式');
  assert.equal(labels.presetDisplayName('', 'ptc'), 'PTC 模式');
  assert.equal(labels.presetDisplayName(null, 'code'), 'PTC 模式');
  // 真正的自定义名字原样保留
  assert.equal(labels.presetDisplayName('My Writer', 'my-writer'), 'My Writer');
  assert.equal(labels.presetDisplayName('团队定制模式', 'code'), '团队定制模式');
});

test('session header label matches DSH roster display semantics', () => {
  const catalog = { presets: [
    { id: 'standard' },
    { id: 'ptc' },
    { id: 'named-standard', name: '标准的自定义覆盖' },
    { id: 'custom-no-name' }
  ] };
  assert.equal(labels.presetHeaderName(catalog, 'standard'), '标准模式');
  assert.equal(labels.presetHeaderName(catalog, 'ptc'), 'PTC 模式');
  assert.equal(labels.presetHeaderName(catalog, 'named-standard'), '标准的自定义覆盖');
  assert.equal(labels.presetHeaderName(catalog, 'custom-no-name'), 'custom-no-name');
  assert.equal(labels.presetHeaderName({ presets: [] }, 'cordis'), '创造模式');
  assert.equal(labels.presetHeaderName({ presets: [] }, 'other-mode'), 'other-mode');
});

test('collaboration header renders its already-localized or host-authored label verbatim', () => {
  for (const file of [
    '../miniprogram/pages/session/session.wxml',
    '../resources/runtime-markup/pages/session/session.wxml'
  ]) {
    const markup = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
    assert.match(markup, /<text class="collab-mode-text">\{\{presetLabel\}\}<\/text>/);
  }
});
