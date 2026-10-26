// 上下文偏好（设置卡）⇄ dsh-context v0.74.0 契约（spec-fleet.md §11）。
//
// 插件把偏好放在 Settings → Context 卡：趋势粒度/模式/耗时曲线、工具与文件活动排序、
// 基线；System Prompt 前后缀是 host 侧设置。小程序把这些存本机（utils/context-prefs），
// 在设置页「上下文面板」分组里编辑，新开的会话读取默认值。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'miniprogram');
const prefsPath = path.join(root, 'pages/settings/utils/context-prefs.js');
const settingsWxml = fs.readFileSync(path.join(root, 'pages/settings/settings.wxml'), 'utf8');
const settingsJs = fs.readFileSync(path.join(root, 'pages/settings/settings.js'), 'utf8');
const sessionJs = fs.readFileSync(path.join(root, 'pages/session/session.js'), 'utf8');
const settingsWxss = fs.readFileSync(path.join(root, 'pages/settings/settings.wxss'), 'utf8');

function freshPrefs() {
  delete require.cache[require.resolve(prefsPath)];
  let stored = null;
  global.wx = {
    getStorageSync() { return stored === null ? '' : stored; },
    setStorageSync(key, value) { stored = JSON.parse(JSON.stringify(value)); }
  };
  return { prefs: require(prefsPath), peek: () => stored };
}

test('prefs validate hostile storage and persist only known values', () => {
  const { prefs, peek } = freshPrefs();
  assert.deepEqual(prefs.read(), { trendGroupBy: 'step', trendDisplayMode: 'total', trendShowDuration: true, fileSort: 'count', base: 'step' });
  const saved = prefs.set({ trendGroupBy: 'turn', trendDisplayMode: 'delta', trendShowDuration: false, fileSort: 'lines', base: 'turn' });
  assert.deepEqual(saved, { trendGroupBy: 'turn', trendDisplayMode: 'delta', trendShowDuration: false, fileSort: 'lines', base: 'turn' });
  assert.deepEqual(peek(), saved);
  // 非法值回落默认，不写坏键。
  const healed = prefs.set({ trendGroupBy: 'week', fileSort: 'size', base: 'x', trendDisplayMode: 1 });
  assert.deepEqual(healed, { trendGroupBy: 'step', trendDisplayMode: 'total', trendShowDuration: false, fileSort: 'count', base: 'step' });
});

test('session defaults come from the saved preferences and reset per session', () => {
  assert.match(sessionJs, /contextTrendGroupBy:\s*contextPreferences\.read\(\)\.trendGroupBy/);
  assert.match(sessionJs, /contextTrendDisplayMode:\s*contextPreferences\.read\(\)\.trendDisplayMode/);
  assert.match(sessionJs, /contextTrendShowDuration:\s*contextPreferences\.read\(\)\.trendShowDuration/);
  assert.match(sessionJs, /contextFileSort:\s*contextPreferences\.read\(\)\.fileSort/);
  assert.match(sessionJs, /contextBrowserBase:\s*contextPreferences\.read\(\)\.base/);
  const resets = sessionJs.match(/contextTrendGroupBy:\s*contextPreferences\.read\(\)\.trendGroupBy/g) || [];
  assert.ok(resets.length >= 2, 'both initial data and the per-session reset read the preference');
});

test('settings card edits every preference with segmented pills', () => {
  assert.match(settingsWxml, /\{\{ui\['上下文面板'\]\}\}/);
  for (const label of ['趋势粒度', '趋势模式', '对比基线', '显示耗时曲线', '文件活动排序', 'System Prompt 前后缀']) {
    assert.ok(settingsWxml.includes("ui['" + label + "']"), label + ' row is present');
  }
  assert.match(settingsWxml, /bindtap="setContextTrendGroup" data-group="step"/);
  assert.match(settingsWxml, /bindtap="setContextTrendMode" data-mode="delta"/);
  assert.match(settingsWxml, /bindtap="setContextBrowserBase" data-base="turn"/);
  assert.match(settingsWxml, /bindchange="toggleContextTrendDuration"/);
  assert.match(settingsWxml, /bindtap="setContextFileSort" data-sort="latest"/);
  assert.match(settingsWxss, /\.ctx-seg-btn\.on\s*\{[^}]*background:\s*var\(--surface\)/);
  assert.match(settingsJs, /contextPreferences\.set\(patch\)/);
});
