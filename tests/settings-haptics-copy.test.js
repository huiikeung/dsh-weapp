const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(result) {
  const file = path.resolve(__dirname, '../miniprogram/pages/settings/settings.js');
  let definition, modal;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; }, setTimeout() {},
    wx: { showModal: value => { modal = value; } },
    require(name) {
      if (name.endsWith('/store')) return {};
      if (name.endsWith('/haptics')) return { getLevel: () => 'medium', setLevel: value => value, vibrate: () => ({ api: 'vibrateLong', ok: true }), test: callback => callback(result) };
      return require(path.resolve(path.dirname(file), name));
    }
  });
  const page = { ...definition, data: {}, setData(patch) { Object.assign(this.data, patch); } };
  return { page, modal: () => modal };
}

test('haptic test reports plain-language outcomes without technical diagnostics', () => {
  for (const [ok, env, expected] of [[true, 'device', '已发送震动测试'], [false, 'device', '暂时无法触发震动'], [true, 'devtools', '请在手机微信中测试']]) {
    const f = fixture({ ok, env, report: [{ name: 'vibrateShort(heavy)', ok, detail: 'errMsg: internal-debug' }] });
    f.page.testHaptics();
    assert.equal(f.modal().title, '震动测试');
    assert.ok(f.modal().content.includes(expected));
    assert.equal(f.page.data.hapticsStatusText, f.modal().content);
    assert.doesNotMatch(JSON.stringify(f.modal()) + f.page.data.hapticsStatusText, /vibrate|errMsg|internal-debug|heavy|fail|ok ·/);
  }
});

test('strength preview and disabled status do not expose API names', () => {
  const { page } = fixture({});
  for (const level of ['light', 'medium', 'heavy', 'off']) {
    page.chooseHaptics({ currentTarget: { dataset: { level } } });
    assert.equal(page.data.hapticsStatusText, level === 'off' ? '已关闭震动' : '已选择震动强度，请感受手机反馈。');
  }
});
