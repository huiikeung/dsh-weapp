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


test('settings skips store emissions that only change session streaming data', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.js'), 'utf8');
  assert.ok(source.includes('if (nextApp && this._settingsAppSignature === this.settingsAppSignature(nextApp)) return;'),
    'the subscribe path short-circuits on an unchanged app signature');
  assert.ok(source.includes('this._settingsAppSignature = this.settingsAppSignature(app);'),
    'syncFromStore records the signature it just rendered');
  assert.ok(source.includes('settingsAppSignature(app) {') && source.includes('app.profiles'),
    'signature covers profile changes');
});

test('running-session stream churn does not rebuild the home list', () => {
  const f = homeFixture();
  const base = 1790000000000;
  f.store.state.sessions = [{ sessionId: 'live', title: '运行中', running: true, updatedAt: base, hasConversation: true }];
  f.store.state.workspaces = [{ workspaceId: 'w1', title: 'W', sessionIds: ['live'] }];
  f.store.state.currentWorkspaceId = 'w1';
  f.page.syncFromStore({ app: f.store.state, session: f.store.sessionState });
  let patches = 0;
  const set = f.page.setData;
  f.page.setData = patch => { patches += 1; set.call(f.page, patch); };
  // 会话仍在后台流式输出：store 的探测帧会把 running 会话的 updatedAt 抬高不到一分钟。
  for (let i = 0; i < 200; i += 1) {
    f.store.state.sessions[0].updatedAt = base + i * 10;
    f.emit();
  }
  assert.equal(patches, 0, 'running updatedAt churn must not resend the home list every frame');
});

test('a completed session update still refreshes the home list', () => {
  const f = homeFixture();
  f.store.state.sessions = [{ sessionId: 'done', title: '已结束', running: false, updatedAt: 1, hasConversation: true }];
  f.store.state.workspaces = [{ workspaceId: 'w1', title: 'W', sessionIds: ['done'] }];
  f.store.state.currentWorkspaceId = 'w1';
  f.page.syncFromStore({ app: f.store.state, session: f.store.sessionState });
  let patches = 0;
  const set = f.page.setData;
  f.page.setData = patch => { patches += 1; set.call(f.page, patch); };
  f.store.state.sessions[0].updatedAt = 61001;
  f.emit();
  assert.ok(patches > 0, 'a finished session moving up the list must still refresh home');
});
