const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { workspacePopoverLayout: layout } = require('../miniprogram/utils/workspace-popover');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', file), 'utf8');
const phone = { windowWidth: 390, windowHeight: 844, statusBarHeight: 47, safeArea: { bottom: 810 } };

test('workspace card keeps the iOS blue outline folder even when ungrouped is selected', () => {
  const html = read('pages/home/home.wxml');
  assert.ok(html.includes('class="ws-icon" src="/assets/icons/workspace-folder-blue.svg" mode="aspectFit"'));
  assert.ok(!html.includes("currentWorkspace.ungrouped ? 'tray-white.png'"));
  const icon = read('assets/icons/workspace-folder-blue.svg');
  assert.ok(icon.includes('viewBox="0 0 24 24" fill="none"'));
  assert.ok(icon.includes('stroke="#2997FF"'));
});

test('menu replaces the source card at its center rather than appearing below it', () => {
  const card = { left: 23, top: 320, width: 344, height: 78 };
  const pop = layout(card, phone, 3, 93);
  assert.equal(pop.popLeft + pop.popWidth / 2, 195);
  assert.equal(pop.popTop + pop.popHeight / 2, 359);
  assert.ok(pop.popWidth < card.width);
  assert.ok(pop.popTop < card.top);
  assert.equal(pop.popOriginY, pop.popHeight / 2);
});

test('safe bounds cover short phones, tablets, long lists and missing card metrics', () => {
  for (const width of [320, 375, 390, 430, 768]) {
    for (const count of [0, 1, 3, 30]) {
      const info = { windowWidth: width, windowHeight: 568, safeArea: { bottom: 540 } };
      for (const top of [10, 240, 500]) {
        const pop = layout({ left: 22, top, width: width - 44, height: 75 }, info, count, 88);
        assert.ok(pop.popLeft >= 16);
        assert.ok(pop.popLeft + pop.popWidth <= width - 16);
        assert.ok(pop.popTop >= 96);
        assert.ok(pop.popTop + pop.popHeight <= 524);
        assert.ok(Number.isFinite(pop.popOriginY));
      }
    }
  }
  const fallback = layout(null, null, 0);
  assert.ok(Object.values(fallback).every(Number.isFinite));
});

function setup() {
  let definition, callback, queryCount = 0;
  const selections = [];
  const state = { workspaces: [{ workspaceId: 'ws-a', title: '第一工作区' }], currentWorkspaceId: null };
  const wx = { getWindowInfo: () => phone, createSelectorQuery() {
    queryCount++;
    return { in() { return this; }, select() { return this; }, boundingClientRect(fn) { callback = fn; return this; }, exec() {} };
  } };
  vm.runInNewContext(read('pages/home/home.js'), {
    Page: value => { definition = value; }, wx,
    require: name => name.endsWith('ui-preferences') ? require('../miniprogram/utils/ui-preferences') : name.endsWith('home-animation-pref') ? { enabled: () => true }
      : name.endsWith('workspace-popover') ? { workspacePopoverLayout: layout }
      : name.endsWith('settings-glass-style-pref') ? { KEY: 'settingsGlassAlpha', DEFAULT: 10, MIN: 4, MAX: 40, read: () => 10, set: value => value, view: () => ({ glassAlpha: 10, glassAlphaTop: '0.040', glassAlphaBottom: '0.016' }) }
      : name.endsWith('settings-glass-pref') ? { KEY: 'settingsGlassStyleEnabled', DEFAULT: true, read: () => true, set: value => value === true }
      : name.endsWith('quota-sidebar-glass-pref') ? { KEY: 'quotaSidebarGlass', DEFAULT: false, read: () => false, set: value => value === true }
      : name.endsWith('/store') ? { state, stopHostProbes() {}, setCurrentWorkspace: id => selections.push(id) } : {}
  });
  const page = { ...definition, data: { ...definition.data, currentWorkspace: { workspaceId: 'ws-a' } },
    topbarTop: 47, topbarH: 44, setData(patch) { Object.assign(this.data, patch); } };
  return { page, wx, selections, queryCount: () => queryCount, finish: () => callback({ left: 23, top: 320, width: 344, height: 78 }) };
}

test('open measures once, shows the displayed selection, and close restores the card', () => {
  const { page, finish, queryCount, selections } = setup();
  page.openWorkspacePicker(); page.openWorkspacePicker();
  assert.equal(queryCount(), 1); assert.equal(page.data.workspacePickerOpen, false);
  finish(); assert.equal(page.data.workspacePickerOpen, true);
  assert.equal(page.data.currentWorkspaceId, 'ws-a');
  page.selectWorkspace({ currentTarget: { dataset: { id: 'ws-a' } } });
  assert.deepEqual(selections, ['ws-a']); assert.equal(page.data.workspacePickerOpen, false);
  page.openWorkspacePicker(); finish(); page.closeWorkspacePicker();
  assert.equal(page.data.workspacePickerOpen, false);
});

test('pending measurement cannot reopen after dismissal or navigation', () => {
  for (const dismiss of ['closeWorkspacePicker', 'onHide']) {
    const { page, finish } = setup();
    page.openWorkspacePicker(); page[dismiss](); finish();
    assert.equal(page.data.workspacePickerOpen, false);
  }
});

test('missing selector API uses a safe fallback menu', () => {
  const { page, wx } = setup(); delete wx.createSelectorQuery;
  page.openWorkspacePicker();
  assert.equal(page.data.workspacePickerOpen, true);
  assert.ok(Number.isFinite(page.data.popTop));
});

test('menu preserves card space, blocks background scroll, and supports long lists', () => {
  const html = read('pages/home/home.wxml');
  const css = read('pages/home/home.wxss');
  assert.ok(html.includes("workspacePickerOpen ? 'workspace-card-menu-open'"));
  assert.ok(html.includes('scroll-y="{{!workspacePickerOpen && !sessionMenuOpen && !swiping}}"'),
    'workspace picker, session menu and swipe gestures all lock the background scroll');
  assert.ok(html.includes('ws-pop-mask" catchtap="closeWorkspacePicker" catchtouchmove="noop"'));
  assert.ok(html.includes('scroll-view class="ws-pop-scroll" scroll-y'));
  assert.ok(css.includes('.workspace-card-menu-open {') && css.includes('visibility: hidden;'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
});
