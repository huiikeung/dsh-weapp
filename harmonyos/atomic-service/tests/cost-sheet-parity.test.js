'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../ascf/ascf_src');
const costMarkup = fs.readFileSync(path.join(root, 'pages/cost-meter/cost-meter.hxml'), 'utf8');
const costStyles = fs.readFileSync(path.join(root, 'pages/cost-meter/cost-meter.css'), 'utf8');
const glassStyles = fs.readFileSync(path.join(root, 'styles/glass-ui.css'), 'utf8');

function section(source, start, end) {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin + start.length);
  assert.ok(begin >= 0 && finish > begin, 'missing section: ' + start);
  return source.slice(begin, finish);
}

function count(source, value) {
  return source.split(value).length - 1;
}

test('cost sheets no longer expose drag-handle touch targets', () => {
  assert.equal(count(costMarkup, 'class="cost-sheet-grabber"'), 0);
  assert.equal(count(costMarkup, 'class="choice-sheet-grabber"'), 0);
  assert.equal(costStyles.includes('.cost-sheet-grabber'), false);
  assert.equal(costStyles.includes('.cost-sheet-grabbar'), false);
});

test('shared choice sheet uses the e60105a inset and row geometry', () => {
  const base = section(glassStyles, '.choice-sheet {', '.choice-sheet-grabber {');
  assert.ok(base.includes('left: 26px;'));
  assert.ok(base.includes('right: 26px;'));
  assert.ok(base.includes('max-height: 72vh;'));
  assert.ok(base.includes('padding: 6rpx 0 calc(10rpx + env(safe-area-inset-bottom));'));
  assert.ok(base.includes('border-radius: 40rpx 40rpx 0 0;'));

  const grabber = section(glassStyles, '.choice-sheet-grabber {', '.choice-sheet-body');
  assert.ok(grabber.includes('padding: 20rpx 0 10rpx;'));
  assert.ok(grabber.includes('width: 64rpx; height: 8rpx;'));
  assert.ok(grabber.includes('rgba(150, 150, 155, 0.45)'));
  assert.ok(glassStyles.includes('.choice-sheet-body { flex: 1; min-height: 0; overflow-y: auto; padding: calc(22rpx + env(safe-area-inset-bottom)) 0 14rpx; text-align: center; }'));

  const rows = section(glassStyles, '.choice-sheet .settings-choice-row {', '.choice-sheet .settings-choice-row-pressed');
  assert.ok(rows.includes('height: 104rpx;'));
  assert.ok(rows.includes('margin: 0 20rpx;'));
  assert.ok(rows.includes('padding: 0 26rpx;'));
  assert.ok(rows.includes('gap: 18rpx;'));
  assert.ok(rows.includes('border-radius: 18rpx;'));
  assert.ok(glassStyles.includes('.choice-sheet .settings-choice-row-pressed { background: var(--fill); }'));

  const glass = section(glassStyles, '.choice-sheet.choice-sheet-glass {', '.choice-sheet.choice-sheet-glass .settings-choice-label');
  assert.ok(glass.includes('left: 22px;'));
  assert.ok(glass.includes('right: 22px;'));
});
