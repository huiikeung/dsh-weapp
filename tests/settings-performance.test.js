const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function homeFixture() {
  const file = path.resolve(__dirname, '../miniprogram/pages/home/home.js');
  let definition, subscriber, navigation, timerId = 0; const calls = [];
  const store = { state: { profiles: [], sessions: [], workspaces: [], connection: 'connected', everConnected: true, gatewayCapabilities: ['cost-meter-v1'] }, sessionState: {},
    client: { requestWorkspaces() {}, requestSessions() {}, requestCostMeter() { return new Promise(() => {}); } },
    stopHostProbes() { calls.push('stopProbes'); }, subscribe(fn) { subscriber = fn; return () => {}; } };
  const wx = { getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44 }), getAppBaseInfo: () => ({ theme: 'light' }),
    navigateTo(options) { calls.push('navigate'); navigation = options; } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: value => { definition = value; }, wx,
    setTimeout: () => ++timerId, clearTimeout: id => calls.push(['clearTimeout', id]),
    clearInterval: id => calls.push(['clearInterval', id]),
    require: name => name.endsWith('/store') ? store : name.endsWith('/theme') ? { resolveTheme: () => 'light' } : require(path.resolve(path.dirname(file), name)) });
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); },
    selectComponent() { return { pause() { calls.push('pause'); } }; } };
  page.onLoad(); calls.length = 0;
  return { page, store, calls, navigation: () => navigation, emit: () => subscriber({ app: store.state, session: store.sessionState }) };
}
test('settings navigates immediately, pauses ocean and ignores duplicate taps', () => {
  const f = homeFixture(); f.page.openSettings(); f.page.openSettings();
  assert.deepEqual(f.calls, ['pause', 'navigate']);
  assert.equal(f.navigation().url, '/pages/settings/settings');
  assert.equal(f.page.data.oceanActive, false);
  f.page.onHide(); assert.equal(f.page.data.drawerOpen, false);
  let patches = 0; const set = f.page.setData; f.page.setData = patch => { patches++; set.call(f.page, patch); };
  f.emit(); f.emit(); assert.equal(patches, 0, 'Hidden home must not rebuild session lists');
  f.store.state.sessions = [{ sessionId: 'new', title: '新会话', hasConversation: true }];
  f.page.onShow(); assert.ok(patches > 0); assert.equal(f.page._homeHidden, false);
  assert.equal(f.page.data.oceanActive, true);
  assert.ok(JSON.stringify(f.page.data).includes('新会话'), 'Returning home reprojects the latest store');
});
test('failed settings navigation restores the live home and allows retry', () => {
  const f = homeFixture(); f.page.openSettings(); f.navigation().fail();
  assert.equal(f.page._homeHidden, false); assert.equal(f.page.data.oceanActive, true);
  f.page.openSettings(); assert.equal(f.calls.filter(x => x === 'navigate').length, 2);
});

test('unchanged session emissions do not resend home lists and hide stops host polling', () => {
  const f = homeFixture(); let patches = 0;
  const set = f.page.setData; f.page.setData = patch => { patches++; set.call(f.page, patch); };
  for (let i = 0; i < 100; i++) f.emit();
  assert.equal(patches, 0);
  f.store.state.sessions.push({ sessionId: 'live', title: '新记录' });
  f.emit(); assert.equal(patches, 1);
  f.page.hostSheetTimer = 123; f.page.onHide();
  assert.ok(f.calls.some(call => Array.isArray(call) && call[0] === 'clearInterval' && call[1] === 123));
  assert.ok(f.calls.includes('stopProbes'));
  assert.equal(f.page.data.hostSheetOpen, false);
});
