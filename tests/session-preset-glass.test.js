const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 新建会话输入框左上角的模式胶囊（pickSessionPreset）和它的预设浮层
// 必须和输入框本身走同一套玻璃材质：同一个 .session-glass 开关、同一组
// --glass-* 变量，关掉开关后仍回落实色。
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ruleOf = (css, selector) => {
  const at = css.indexOf(selector);
  assert.ok(at >= 0, selector + ' rule exists');
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
};

test('模式胶囊和预设浮层跟随输入框的玻璃开关', () => {
  for (const file of ['resources/runtime-markup/pages/session/session.wxml', 'miniprogram/pages/session/session.wxml']) {
    const wxml = read(file);
    assert.match(wxml, /<view wx:if="\{\{sessionPresetVisible\}\}" class="preset-capsule glass-press" bindtap="pickSessionPreset">/, file + ': preset capsule stays tappable');
    // 浮层单独一个 mode-pop 标记，玻璃规则不会误伤权限/模型浮层
    assert.ok(wxml.includes('<view wx:if="{{modeSheet.length}}" class="opt-pop mode-pop">'), file + ': mode popup carries the mode-pop hook');
    assert.ok(!wxml.includes('class="opt-pop permission-pop mode-pop"'), file + ': permission popup stays solid');
  }
});

test('胶囊与浮层复用输入框的玻璃配方', () => {
  for (const file of ['resources/runtime-markup/pages/session/session.wxss', 'miniprogram/pages/session/session.wxss']) {
    const css = read(file);
    const composer = ruleOf(css, '.session-glass .composer');
    const capsule = ruleOf(css, '.session-glass .preset-capsule');
    const popup = ruleOf(css, '.session-glass .opt-pop.mode-pop');
    // 同一个渐变角度和同一组透明度变量 -> 与输入框同一材质
    const gradient = (rule) => (rule.match(/linear-gradient\(165deg[^;]+;/) || [''])[0];
    assert.ok(gradient(capsule), file + ': capsule gradient');
    assert.equal(gradient(capsule), gradient(composer), file + ': capsule shares the composer gradient');
    assert.ok(capsule.includes('var(--glass-edge-alpha'), file + ': capsule hairline');
    assert.ok(capsule.includes('blur(var(--glass-blur-card'), file + ': capsule blur');
    assert.ok(capsule.includes('-webkit-backdrop-filter'), file + ': capsule webkit blur');
    // 浮层是浮起来的菜单：沿用 sheet 档透明度与模糊，仍是同一套变量
    assert.ok(popup.includes('var(--glass-alpha-top, 0.10)'), file + ': popup gradient');
    assert.ok(popup.includes('var(--glass-edge-alpha'), file + ': popup hairline');
    assert.ok(popup.includes('blur(var(--glass-blur-sheet'), file + ': popup blur');
    assert.ok(popup.includes('-webkit-backdrop-filter'), file + ': popup webkit blur');
    // 深色下描边不变，阴影压暗
    assert.ok(ruleOf(css, '.theme-dark.session-glass .preset-capsule').includes('rgba(0, 0, 0, 0.34)'), file + ': dark capsule shadow');
    assert.ok(ruleOf(css, '.theme-dark.session-glass .opt-pop.mode-pop').includes('rgba(0, 0, 0, 0.42)'), file + ': dark popup shadow');
  }
});

test('华为 ASCF 副本与小程序保持同一材质', () => {
  const css = read('harmonyos/atomic-service/ascf/ascf_src/pages/session/session.css');
  const hxml = read('harmonyos/atomic-service/ascf/ascf_src/pages/session/session.hxml');
  assert.ok(hxml.includes('class="opt-pop mode-pop"'), 'ascf mode popup hook');
  const capsule = ruleOf(css, '.session-glass .preset-capsule');
  const popup = ruleOf(css, '.session-glass .opt-pop.mode-pop');
  assert.ok(capsule.includes('var(--glass-alpha-top, 0.06)') && capsule.includes('blur(var(--glass-blur-card'), 'ascf capsule glass');
  assert.ok(popup.includes('var(--glass-alpha-top, 0.10)') && popup.includes('blur(var(--glass-blur-sheet'), 'ascf popup glass');
});
