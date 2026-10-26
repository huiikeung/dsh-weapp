const test = require('node:test');
const assert = require('node:assert/strict');
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
