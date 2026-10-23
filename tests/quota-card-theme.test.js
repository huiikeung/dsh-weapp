'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wxss = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/home/home.wxss'), 'utf8');
const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/home/home.wxml'), 'utf8');
const appWxss = fs.readFileSync(path.join(__dirname, '../miniprogram/app.wxss'), 'utf8');

/** 取出某个选择器块的声明体（花括号内）。 */
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(css);
  return match ? match[1] : '';
}

test('sidebar quota card colors come from theme variables, not hardcoded whites', () => {
  const quota = block(wxss, '.drawer-quota');
  assert.ok(quota.includes('var(--surface)'), '卡片背景必须用 var(--surface)');
  assert.ok(quota.includes('var(--text)'), '卡片文字必须用 var(--text)');
  assert.ok(quota.includes('var(--border)'), '卡片边框必须用 var(--border)');
  assert.ok(quota.includes('var(--card-shadow)'), '卡片阴影必须用 var(--card-shadow)');

  for (const selector of ['.dq-name', '.dq-value', '.dq-link', '.dq-progress', '.dq-progress-fill', '.dq-meta', '.dq-block', '.dq-peak-phase', '.dq-dot']) {
    const body = block(wxss, selector);
    assert.ok(!/rgba\(245,\s*247,\s*250/.test(body), selector + ' 不得残留硬编码白色文字');
    assert.ok(!/rgba\(255,\s*255,\s*255/.test(body), selector + ' 不得残留硬编码白色边框/轨道');
    assert.ok(!/#2b2b2e|#f4f5f7|#80aaff|#7fa9ff/.test(body), selector + ' 不得残留硬编码深色卡片色板');
  }

  // 主题变量确实在 app.wxss 中为浅/深两套取值
  assert.match(appWxss, /--surface:\s*#FFFFFF/);
  assert.match(appWxss, /--surface:\s*#1C1C1E/);
  assert.match(appWxss, /--text:\s*#10131A/);
  assert.match(appWxss, /--text:\s*#F1F4FA/);
});

test('home root view carries themeClass so manual dark mode switches variables', () => {
  assert.match(wxml, /class="page page-dark home-root \{\{themeClass\}\}"/, '根视图必须挂 themeClass');
});

test('quota card sits in the bottom group above the settings entry', () => {
  // 结构：drawer-bottom 包住 卡片(wx:if) / 错误卡(wx:elif) / drawer-footer(设置)
  assert.match(wxml, /<view class="drawer-bottom">/);
  assert.match(wxml, /<view wx:if="\{\{costSidebar\}\}" class="drawer-quota /);
  assert.match(wxml, /<view wx:elif="\{\{costCardError\}\}" class="drawer-cost-unavailable"/);
  assert.match(wxml, /<view class="drawer-footer">/);
  // drawer-bottom 必须靠 margin-top:auto 贴底，且 footer 不再自己贴底
  const bottom = block(wxss, '.drawer-bottom');
  assert.ok(bottom.includes('margin-top: auto'), 'drawer-bottom 需要 margin-top:auto 才能贴底');
  assert.ok(!block(wxss, '.drawer-footer').includes('margin-top: auto'), '贴底职责已移交给 drawer-bottom');
});

test('applySheetTheme publishes themeClass alongside sheetTheme', () => {
  const src = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/home/home.js'), 'utf8');
  assert.match(src, /applySheetTheme\(\)\s*\{[^}]*themeClass:\s*'theme-'\s*\+\s*resolved/s, 'applySheetTheme 必须同时写 themeClass');
  assert.match(src, /sheetTheme:\s*'dark',\s*\n\s*themeClass:\s*'theme-dark'/, 'data 需要 themeClass 初值，避免首帧 undefined');
});
