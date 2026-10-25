const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');

test('the lead agent uses the two-person glyph and sub agents use the single one', () => {
  // 成员板与任务卡共用同一个图标容器。
  assert.match(wxml, /member\.kind === 'lead'[^>]*src="\/assets\/icons\/icon-users/,
    'lead rows use the two-person icon');
  assert.match(wxml, /else[^>]*class="fleet-member-ic" src="\/assets\/icons\/icon-user\{\{/,
    'sub agent rows use the single-person icon');
  for (const icon of ['icon-user', 'icon-users', 'icon-user-dark', 'icon-users-dark']) {
    assert.ok(fs.existsSync(path.resolve(__dirname, '../miniprogram/assets/icons', icon + '.svg')),
      'icon asset exists: ' + icon);
  }
});

test('the glyph is sized inside its tinted box instead of falling back to the 320x240 default', () => {
  // <image> 没有尺寸规则时会用微信默认的 320x240，把 36rpx 的方框撑爆。
  const base = wxss.match(/\.fleet-member-ic \{[^}]*\}/);
  assert.ok(base, '.fleet-member-ic must have its own size rule');
  assert.match(base[0], /width: 20rpx; height: 20rpx/, 'glyph is 20rpx inside the 36rpx box');
  assert.match(wxss, /\.fleet-member-icon \{ width: 44rpx; height: 44rpx;[^}]*\}\s*\n\.fleet-member-ic \{ width: 24rpx; height: 24rpx; \}/,
    'the wide-screen box scales the glyph with it');
});

test('the tinted box follows the family hue', () => {
  assert.match(wxml, /class="fleet-member-icon" style="background:\{\{member\.hue\}\}22;border-color:\{\{member\.hue\}\}88;"/,
    'member box tint + border come from the family hue');
  assert.match(wxml, /class="fleet-task-icon" style="background:\{\{item\.hue\}\}22;border-color:\{\{item\.hue\}\}88;"/,
    'delegated-agent task rows use the same hue tint');
  assert.match(wxml, /wx:if="\{\{item\.kind === 'agent'\}\}" class="fleet-task-icon"/,
    'team task rows do not get the agent avatar glyph');
});

test('fleet module titles use the DSH icon artwork in both themes', () => {
  for (const [name, pathData] of [
    ['fleet-network', 'M14 12.05c0 .8-.65 1.45-1.46 1.45H3.46'],
    ['fleet-comms', 'M6.97211 1.94476C7.55785 1.35914'],
    ['icon-user', 'M8 8.25C9.51878 8.25 10.75 7.01878'],
    ['icon-users', 'M6 8.25C7.51878 8.25 8.75 7.01878'],
    ['dsh-checklist', 'M3.75 6.25C4.7165 6.25 5.5 5.4665']
  ]) {
    for (const suffix of ['', '-dark']) {
      const iconPath = path.resolve(__dirname, '../miniprogram/assets/icons', name + suffix + '.svg');
      assert.ok(fs.existsSync(iconPath), 'icon asset exists: ' + name + suffix);
      assert.ok(fs.readFileSync(iconPath, 'utf8').includes(pathData), 'DSH artwork is preserved: ' + name + suffix);
    }
  }
  assert.match(wxml, /fleet-network\{\{theme === 'dark' \? '-dark' : ''\}\}\.svg/);
  assert.match(wxml, /fleet-comms\{\{theme === 'dark' \? '-dark' : ''\}\}\.svg/);
  assert.match(wxml, /dsh-checklist\{\{theme === 'dark' \? '-dark' : ''\}\}\.svg/);
});
