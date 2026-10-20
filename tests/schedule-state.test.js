'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'miniprogram');
const template = fs.readFileSync(path.join(root, 'pages/schedule/schedule.wxml'), 'utf8');

test('schedule error state uses the local offline vector without stretching', () => {
  const errorState = template.match(/<view wx:elif="{{error && !tasks.length}}"[^>]*>([\s\S]*?)<\/view>/);
  assert.ok(errorState, 'error state remains available');
  assert.match(errorState[1], /src="\/pages\/schedule\/assets\/icons\/sched-offline-gray\.svg" mode="aspectFit"/);
  assert.match(errorState[1], /ui\[error\]/);
  assert.match(errorState[1], /bindtap="onRetry"/);
  const icon = fs.readFileSync(path.join(root, 'pages/schedule/assets/icons/sched-offline-gray.svg'), 'utf8');
  assert.match(icon, /viewBox="0 0 48 48"/);
  assert.match(icon, /stroke="#8E8E93"/);
  assert.doesNotMatch(icon, /<image|<script|href=/);
});

test('schedule empty state retains its clock illustration', () => {
  const emptyState = template.match(/<view wx:elif="{{!tasks.length}}"[^>]*>([\s\S]*?)<\/view>/);
  assert.ok(emptyState);
  assert.match(emptyState[1], /src="\/assets\/icons\/sched-clock-gray\.png"/);
});
