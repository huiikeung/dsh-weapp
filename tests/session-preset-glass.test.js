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
    const gradient = 'linear-gradient(165deg, rgba(255, 255, 255, var(--glass-alpha-top, 0.06)), rgba(255, 255, 255, var(--glass-alpha-bottom, 0.015)))';
    const frostBase = 'rgba(44, 45, 49, 0.62)';
    assert.ok(capsule.includes(gradient) && capsule.includes(frostBase), file + ': capsule gradient');
    assert.ok(composer.includes(gradient) && composer.includes(frostBase), file + ': capsule shares the composer gradient');
    // iOS 磨砂：描边和模糊都走 --glass-frost-*
    assert.ok(capsule.includes('var(--glass-frost-edge'), file + ': capsule hairline');
    assert.ok(capsule.includes('blur(var(--glass-frost-blur'), file + ': capsule blur');
    assert.ok(capsule.includes('-webkit-backdrop-filter'), file + ': capsule webkit blur');
    // 浮层与输入框同一档磨砂，不再是 sheet 档的弱模糊
    assert.ok(popup.includes(gradient) && popup.includes(frostBase), file + ': popup gradient');
    assert.ok(popup.includes('var(--glass-frost-edge'), file + ': popup hairline');
    assert.ok(popup.includes('blur(var(--glass-frost-blur'), file + ': popup blur');
    assert.ok(popup.includes('-webkit-backdrop-filter'), file + ': popup webkit blur');
    // 浅色：近白磨砂 + 墨色发丝边
    const lightCapsule = ruleOf(css, '.theme-light.session-glass .preset-capsule');
    const lightPopup = ruleOf(css, '.theme-light.session-glass .opt-pop.mode-pop');
    assert.ok(lightCapsule.includes('rgba(247, 248, 251, 0.86)') && lightCapsule.includes('inset 0 0 16rpx rgba(255, 255, 255, 0.50)'), file + ': light capsule uses a soft white rim glow');
    assert.ok(lightPopup.includes('rgba(247, 248, 251, 0.86)') && lightPopup.includes('inset 0 0 22rpx rgba(255, 255, 255, 0.55)'), file + ': light popup uses a soft white rim glow');
    // 深色阴影收在基础规则里
    assert.ok(capsule.includes('0 8rpx 24rpx rgba(3, 14, 30, 0.20)'), file + ': dark capsule shadow');
    assert.ok(popup.includes('0 18rpx 48rpx rgba(3, 14, 30, 0.26)'), file + ': dark popup shadow');
    assert.ok(!/inset 0 1rpx 0 rgba\(255, 255, 255, 0\.1/.test(capsule), file + ': dark capsule keeps no top highlight');
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
