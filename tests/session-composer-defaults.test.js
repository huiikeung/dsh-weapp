'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('plus, permission, and model controls render without waiting for a gateway frame', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const composer = wxml.slice(wxml.indexOf('<view class="composer-bar">'), wxml.indexOf('<!-- DSH composer footer'));

  for (const [name, handler] of [
    ['composer-plus', 'attachMenu'],
    ['permission-chip', 'pickPermission'],
    ['model-chip', 'pickModel']
  ]) {
    const element = composer.match(new RegExp(`<view[^>]*class="[^"]*${name}[^"]*"[^>]*>`));
    assert.ok(element, `${name} exists in the default composer`);
    assert.ok(element[0].includes(`bindtap="${handler}"`), `${name} remains interactive`);
    assert.ok(!element[0].includes('wx:if='), `${name} is not gated on connection state`);
  }

  const page = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.js'), 'utf8');
  assert.match(page, /permissionLabel:\s*uiText\('工作区写入'\)/);
  assert.match(page, /modelLabel:\s*'DeepSeek'/);
});

test('all three composer statistics buttons render with placeholders before stats arrive', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const start = wxml.indexOf('class="composer-metrics"');
  assert.ok(start >= 0, 'composer metrics container exists');
  const footer = wxml.slice(start);
  for (const [name, handler] of [
    ['composer-metric run', 'showStats'],
    ['composer-metric token', 'showTokenStats'],
    ['composer-metric context', 'openContextSheet']
  ]) {
    const element = footer.match(new RegExp(`<view[^>]*class="${name}"[^>]*>`));
    assert.ok(element, `${name} exists in the footer`);
    assert.ok(element[0].includes(`bindtap="${handler}"`), `${name} remains interactive`);
    assert.ok(!element[0].includes('wx:if='), `${name} is not hidden until a stats response`);
  }
  assert.equal((footer.match(/class="composer-metric /g) || []).length, 3);

  const page = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.js'), 'utf8');
  assert.match(page, /composerMetricsVisible:\s*true/);
  assert.match(page, /composerRunMetric:\s*'— 轮 — 步'/);
  assert.match(page, /composerTokenMetric:\s*'— tok'/);
  assert.match(page, /composerCacheMetric:\s*'— tok'/);
  assert.match(page, /composerContextMetric:\s*'—%'/);
  assert.match(wxml, /class="composer-metric-text">\{\{composerTokenMetric\}\}/,
    'the token button displays the DSH whole-session token total');
});

test('the composer starts at its resting height instead of the native 150px first frame', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  const page = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.js'), 'utf8');

  // 真机上原生 textarea 的默认高度是 150px，而且 CSS 夹不住它（父级 overflow / max-height 都无效，
  // 探针实测首帧 i=150px）。所以直接把首帧高度写进 textarea 自己的 style；量到内容后由 auto-height 接管。
  const textarea = wxml.slice(wxml.indexOf('<textarea'), wxml.indexOf('/>', wxml.indexOf('<textarea')) + 2);
  assert.match(textarea, /style="height:\{\{composerInputHeightPx\}\}px"/, 'the textarea carries an explicit first-frame height');
  assert.match(textarea, /auto-height="\{\{true\}\}"/, 'auto-height still drives growth once it measures');
  assert.match(textarea, /bindlinechange="onComposerLineChange"/);
  assert.ok(!/composer-input-clamped|composer-first-frame/.test(wxml), 'the ineffective row clamp is gone');
  assert.ok(!/composer-input-clamped|composer-first-frame/.test(wxss), 'the ineffective CSS clamp is gone');
  assert.match(page, /composerInputHeightPx:\s*38/);
  assert.match(page, /const oneLinePx = Math\.max\(24, Math\.round\(76 \* winW \/ 750\)\)/);
  assert.match(page, /composerInputHeightPx: oneLinePx/);
});

test('entering a session does not duplicate the projection or poll the scroll view while idle', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.js'), 'utf8');
  // onLoad 已经同步过同一份快照：onShow 在 400ms 内不再整份重投影（冷启动最大的一笔重复开销）。
  assert.match(page, /syncFromStore\(snapshot\) \{\s*\/\/[\s\S]{0,200}?this\._lastSyncAt = Date\.now\(\)/);
  assert.match(page, /Date\.now\(\) - \(this\._lastSyncAt \|\| 0\) > 400/);
  // 空闲（没有回合在跑）时内容高度不会变，350ms 的三连 selector 查询全部跳过。
  assert.match(page, /pollScrollPosition\(\) \{\s*if \([^)]*\) return;[\s\S]{0,400}?if \(!this\.data\.running\) return;/);
  // 首帧不做编队舞台的 selector 查询，挪到 400ms 后。
  const readyBody = page.slice(page.indexOf('onReady() {'), page.indexOf('onReady() {') + 2000);
  assert.match(readyBody, /_fleetMeasureTimer = setTimeout\b/);
  assert.ok(readyBody.indexOf('_fleetMeasureTimer = setTimeout') < readyBody.indexOf('this.measureFleetStage()'),
    'onReady schedules the fleet measurement instead of running it inline');
});
