const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { dataPatch, createMarkdownCache } = require('../miniprogram/utils/session-render');
const clone = value => JSON.parse(JSON.stringify(value));
function apply(data, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let parent = data;
    parts.slice(0, -1).forEach((part, i) => {
      if (parent[part] == null) parent[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      parent = parent[part];
    });
    parent[parts.at(-1)] = clone(value);
  });
}
test('data bridge updates append, shrink, reorder and removed properties correctly', () => {
  const before = { rows: [{ key: 'a', text: 'old', blocks: [{ html: 'old' }] }], running: true };
  const next = { rows: [{ key: 'a', text: 'new', blocks: [{ html: 'new' }] }, { key: 'b', text: 'reply' }], running: false };
  const patch = dataPatch(before, next);
  assert.equal(patch.rows, undefined); assert.equal(patch['rows[0].text'], 'new');
  apply(before, patch); assert.deepEqual(before, next);
  for (const target of [
    { rows: [{ key: 'b', text: 'reply' }, { key: 'a', text: 'new' }], running: false },
    { rows: [], running: false }, { rows: [{ key: 'a' }], running: false },
    { rows: [{ key: 'a', blocks: [{ html: 'first' }, { html: 'second' }] }], running: false }
  ]) { apply(before, dataPatch(before, target)); assert.deepEqual(before, target); }
  assert.deepEqual(dataPatch(before, clone(before)), {});
});
test('markdown cache checks actual text and prunes removed messages', () => {
  let calls = 0;
  const cache = createMarkdownCache(text => { calls++; return [{ text }]; });
  const original = cache.parse('a', 'same');
  assert.equal(cache.parse('a', 'same'), original);
  assert.notEqual(cache.parse('a', 'changed'), original);
  cache.retain([]); cache.parse('a', 'changed'); assert.equal(calls, 3);
});
function fixture(source) {
  let definition, parses = 0, scrolls = 0, measurements = 0;
  const patches = [], ticks = [];
  const store = { state: { connection: 'connected', sessions: [] }, sessionState: {
    sessionId: 'performance-test', rows: [], trajectory: [], running: true,
    runStartMs: Date.now() - 3000, historyState: 'loaded:300ev', stats: null
  } };
  for (let i = 0; i < 150; i++) {
    store.sessionState.rows.push({ kind: 'user', key: 'u' + i, text: '问题' + i });
    store.sessionState.rows.push({ kind: 'assistant', key: 'a' + i, text: '## 标题 ' + i + '\n\n' + '历史回复内容。'.repeat(150), tools: [] });
  }
  store.sessionState.rows.push({ kind: 'assistant', key: 'current', reasoning: '检查完成', text: '测试完成', streaming: true, tools: [] });
  const filename = path.join(__dirname, '../miniprogram/pages/session/session.js');
  vm.runInNewContext(source || fs.readFileSync(filename, 'utf8'), {
    Page: value => { definition = value; }, Date, console,
    wx: { nextTick: fn => ticks.push(fn) },
    require(name) {
      if (name.endsWith('/store')) return store;
      if (name.endsWith('/markdown')) return { parse(text) { parses++; return require('../miniprogram/utils/markdown').parse(text); } };
      return require(path.resolve(path.dirname(filename), name));
    }
  });
  const page = { ...definition, data: clone(definition.data),
    setData(patch, callback) { patches.push(clone(patch)); apply(this.data, patch); if (callback) callback(); },
    syncRunningStrip() {}, updateDockInset() { measurements++; }, refreshBottomAnchor() { scrolls++; } };
  const sync = () => page.syncFromStoreInner({ app: store.state, session: store.sessionState });
  const reset = () => { patches.length = 0; parses = 0; scrolls = 0; measurements = 0; };
  return { page, store, definition, ticks, sync, reset, patches, report: () => ({ parses, scrolls, measurements, bytes: Buffer.byteLength(JSON.stringify(patches)) }) };
}
test('completion does not reparse or resend historical Markdown', () => {
  const f = fixture(); f.sync(); f.reset();
  const beforeBytes = Buffer.byteLength(JSON.stringify(f.page.data.rows));
  f.store.sessionState.running = false; f.store.sessionState.rows.at(-1).streaming = false; f.sync();
  const report = f.report();
  assert.equal(report.parses, 0); assert.equal(report.scrolls, 1); assert.equal(report.measurements, 1); // Docked whale disappears at completion.
  assert.ok(report.bytes < beforeBytes / 20, JSON.stringify({ report, beforeBytes }));
  assert.ok(f.patches.every(patch => !Object.hasOwn(patch, 'rows')));
  assert.equal(f.page.data.running, false); assert.equal(f.page.data.rows.at(-1).text, '测试完成');
  assert.ok(f.page.data.rows.some(row => row.kind === 'processGroup' && row.completed));
  f.reset();
  for (let i = 0; i < 8; i++) { f.store.sessionState.stats = { stats: { turns: 151, steps: i + 1 } }; f.sync(); }
  assert.equal(f.report().parses, 0); assert.equal(f.report().scrolls, 0);
  assert.ok(f.patches.every(p => !Object.keys(p).some(k => k === 'rows' || k.startsWith('rows['))));
});
test('final text, in-place tool updates, history prepend and session switch still render', () => {
  const f = fixture(); f.sync(); f.reset();
  f.store.sessionState.rows.at(-1).text = '**新的最终答复**'; f.sync();
  assert.equal(f.report().parses, 1);
  assert.ok(f.page.data.rows.find(row=>row.key==='current').blocks[0].html.includes('<strong>新的最终答复</strong>'));
  f.store.sessionState.rows.at(-1).tools = [{ callId: 'tool', name: 'read', status: 'running' }]; f.sync();
  f.store.sessionState.rows.at(-1).tools[0].status = 'done'; f.sync();
  const group = f.page.data.rows.find(row => row.kind === 'processGroup');
  assert.equal(group.children.find(child => child.kind === 'toolBundle').tools[0].waiting, false);
  f.store.sessionState.rows.unshift({ kind: 'user', key: 'older', text: '更早历史' }); f.sync();
  assert.equal(f.page.data.rows[0].key, 'older');
  f.store.sessionState.sessionId = 'another'; f.store.sessionState.rows = [{ kind: 'assistant', key: 'a0', text: '另一会话' }]; f.sync();
  assert.equal(f.page.data.rows.length, 1); assert.equal(f.page.data.rows[0].text, '另一会话');
});
test('bottom scrolling coalesces callbacks and never updates an unloaded page', () => {
  const f = fixture(); f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  f.page.refreshBottomAnchor(); f.page.refreshBottomAnchor(); assert.equal(f.ticks.length, 1);
  f.page._unloaded = true; f.ticks.shift()(); assert.equal(f.patches.length, 1);
});
module.exports = { fixture };
test('files arriving after completion publish immediately and respect history reading', () => {
  for (const pinned of [true, false]) {
    const f=fixture();f.sync();f.store.sessionState.running=false;f.sync();f.reset();f.page._convPinned=pinned;
    f.store.sessionState.rows.push({kind:'files',key:'delivered',turn:1,sessionId:'performance-test',files:[{key:'file-1',path:'output/report.pdf',description:'Completed report',seq:900,index:0}]});
    f.sync();
    const card=f.page.data.rows.find(row=>row.kind==='files');
    assert.equal(card.files[0].name,'report.pdf');assert.equal(card.files[0].subtitle,'Completed report');
    assert.equal(f.report().parses,0);assert.equal(f.report().scrolls,Number(pinned));
    assert.ok(f.patches.some(p=>Object.keys(p).some(key=>key.startsWith('rows['))));
  }
});
test('bottom anchor reset commits before targeting and a new touch cancels the pending jump', () => {
  const f=fixture(), commits=[];
  f.page.refreshBottomAnchor=f.definition.refreshBottomAnchor;
  f.page.setData=(patch, callback)=>{apply(f.page.data,patch);if(callback)commits.push(callback);};
  f.page.refreshBottomAnchor();assert.equal(f.ticks.length,0);assert.equal(f.page.data.scrollTarget,'');
  commits.shift()();assert.equal(f.ticks.length,1);f.ticks.shift()();assert.equal(f.page.data.scrollTarget,'conv-bottom');
  f.page.refreshBottomAnchor();commits.shift()();f.page.onConvTouch();f.ticks.shift()();
  assert.equal(f.page.data.scrollTarget,'');assert.equal(f.page._bottomAnchorPending,false);
});
test('empty conversation keeps its centered state instead of jumping to the bottom anchor', () => {
  const f = fixture();
  f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  f.page.data.historyLoaded = true;
  f.page.data.rows = [];
  f.page.refreshBottomAnchor();
  assert.equal(f.ticks.length, 0);            // 空态不触发 scroll-into-view，避免被贴底顶高
  assert.equal(f.page.data.scrollTarget, '');
  assert.ok(!f.page._bottomAnchorPending);
  f.page.data.rows = [{ kind: 'user', key: 'u1', text: 'hi' }];
  f.page.refreshBottomAnchor();
  assert.equal(f.ticks.length, 1);            // 有消息后恢复贴底
});

test('inactive trajectory skips projection and view updates but opens with latest source', () => {
  const f = fixture();
  const view = require('../miniprogram/utils/trajectory-presentation');
  const original = view.listRow; let projections = 0;
  view.listRow = row => { projections++; return original(row); };
  try {
    f.store.sessionState.trajectory = [{ kind: 'event', key: 'event-1', badge: 'USER', label: 'User', seq: 1, text: 'first' }];
    f.sync();
    assert.equal(projections, 0); assert.equal(f.page.data.trajectory.length, 0);
    f.store.sessionState.trajectory = [{ kind: 'event', key: 'event-2', badge: 'USER', label: 'User', seq: 2, text: 'latest' }];
    f.sync(); assert.equal(projections, 0);
    f.page.data.tab = 'trajectory'; f.sync();
    assert.equal(projections, 1); assert.equal(f.page.data.trajectory[0].key, 'event-2');
    f.reset(); f.sync(); assert.equal(projections, 1);
    assert.ok(f.patches.every(patch => !Object.keys(patch).some(key => key.startsWith('trajectory') || key.startsWith('traceOverview'))));
    f.store.sessionState.sessionId = 'next-session';
    f.store.sessionState.trajectory = []; f.sync();
    assert.equal(f.page.data.trajectory.length, 0);
  } finally { view.listRow = original; }
});

test('authoritative history rebuilds semantic rows and trajectory only once', () => {
  const real = require('../miniprogram/utils/protocol');
  let applies = 0, trajectories = 0, builds = 0;
  const protocol = { ...real,
    applyEvent(...args) { applies++; return real.applyEvent(...args); },
    buildRows(...args) { builds++; return real.buildRows(...args); },
    buildTrajectory(...args) { trajectories++; return real.buildTrajectory(...args); }
  };
  const filename = path.join(__dirname, '../miniprogram/utils/store.js');
  const module = { exports: {} };
  class Client { constructor(callbacks) { this.callbacks = callbacks; } }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, Date, console, wx: { getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    require(name) {
      if (name === './gateway') return { GatewayClient: Client };
      if (name === './protocol') return protocol;
      return require(path.resolve(path.dirname(filename), name));
    }
  });
  const store = module.exports;
  store.sessionState.sessionId = 'history-test';
  const events = [
    { type: 'user/message', seq: 1, time: 1, data: { message: { role: 'user', content: [{ type: 'text', text: '问题' }] } } },
    { type: 'assistant/message', seq: 2, time: 2, data: { message: { role: 'assistant', content: [{ type: 'text', text: '完整回复' }] } } }
  ];
  store.client.callbacks.onFrame({ kind: 'history', sessionId: 'history-test', events });
  const expected = clone(store.sessionState.rows);
  applies = 0; trajectories = 0; builds = 0;
  store.client.callbacks.onFrame({ kind: 'history', sessionId: 'history-test', events });
  assert.deepEqual(clone(store.sessionState.rows), expected);
  assert.equal(applies, 2); assert.equal(trajectories, 1); assert.equal(builds, 0);
});

