// 兑换码档位：小程序（设置页弹窗 + 独立页面）与服务端白名单必须完全一致，
// 否则用户选得到、服务端 400「访问时长或次数无效」。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const server = read('dsh-console/services/public-access/server.cjs');
const settings = read('miniprogram/pages/settings/settings.js');
const redeemAdmin = read('miniprogram/pages/redeem-admin/redeem-admin.js');

const list = (source, name) => {
  const found = source.match(new RegExp('const ' + name + ' = \\[([^\\]]*)\\];'));
  assert.ok(found, name + ' must be declared');
  return found[1].split(',').map(value => Number(value.trim())).filter(Number.isFinite);
};
const keys = (source, name) => {
  const found = source.match(new RegExp('const ' + name + ' = \\[([^\\]]*)\\];'));
  assert.ok(found, name + ' must be declared');
  return [...found[1].matchAll(/'([^']*)'/g)].map(match => match[1]);
};

const SERVER_DAYS = list(server, 'CODE_DAYS');
const SERVER_USES = list(server, 'CODE_USES');

test('the server accepts every ladder the client offers', () => {
  assert.deepEqual(SERVER_DAYS, [1, 3, 7, 30, 60, 90, 180, 365, 730, 1095, 3650]);
  assert.deepEqual(SERVER_USES, [1, 5, 20, 50, 100]);
  assert.match(server, /CODE_DAYS\.includes\(input\.days\)[\s\S]{0,80}CODE_USES\.includes\(input\.uses\)/,
    'the create handler validates against the shared ladders');
  assert.ok(!/\[3, 7, 30, 180, 365\]/.test(server), 'no stale inline whitelist is left behind');
});

test('both client surfaces mirror the server ladders exactly', () => {
  assert.deepEqual(list(settings, 'CODE_DURATION_DAYS'), SERVER_DAYS, 'settings page days');
  assert.deepEqual(list(settings, 'CODE_USES'), SERVER_USES, 'settings page uses');
  assert.deepEqual(list(redeemAdmin, 'DAYS'), SERVER_DAYS, 'standalone page days');
  assert.deepEqual(list(redeemAdmin, 'USES'), SERVER_USES, 'standalone page uses');
  // 文案与天数一一对应，少一条说明 picker 会显示错位。
  assert.equal(keys(settings, 'CODE_DURATION_KEYS').length, SERVER_DAYS.length);
  assert.equal(keys(settings, 'CODE_USE_KEYS').length, SERVER_USES.length);
  assert.equal(keys(redeemAdmin, 'DURATION_KEYS').length, SERVER_DAYS.length);
  assert.equal(keys(redeemAdmin, 'USE_KEYS').length, SERVER_USES.length);
});

test('the picker opens on 30 days and every label is translated', () => {
  assert.match(settings, /codeDurationIndex: 3,/, 'settings page defaults to 30 days (index 3)');
  assert.match(redeemAdmin, /durationIndex: 3/, 'standalone page defaults to 30 days too');
  const dictionary = { ...require('../miniprogram/i18n/interface') };
  const labels = keys(settings, 'CODE_DURATION_KEYS').concat(keys(settings, 'CODE_USE_KEYS'),
    keys(redeemAdmin, 'DURATION_KEYS'), keys(redeemAdmin, 'USE_KEYS'));
  for (const label of new Set(labels)) {
    assert.ok(dictionary[label], 'missing translation: ' + label);
    assert.equal(/[\u3400-\u9fff]/.test(dictionary[label]), false, 'untranslated: ' + label);
  }
});

test('locale switches rebuild the locally composed labels', () => {
  assert.match(settings, /onUiLocaleChange\(\)\s*\{[\s\S]{0,200}codeDurationLabels\(\)[\s\S]{0,80}codeUseLabels\(\)/,
    'settings page rebuilds ladder labels');
  assert.match(redeemAdmin, /onUiPreferencesChange\(\)\s*\{[^}]*DURATION_KEYS\.map\(uiText\)/,
    'standalone page rebuilds ladder labels');
});
