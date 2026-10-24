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
  const start = wxml.indexOf('<!-- DSH composer footer');
  const end = wxml.indexOf('</view>\n      </view>', wxml.indexOf('class="composer-metrics"', start));
  const footer = wxml.slice(start, end);
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
