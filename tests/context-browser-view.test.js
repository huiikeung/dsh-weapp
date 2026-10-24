'use strict';

// v2 上下文浏览器 + 原生 WXML 渲染回归：
// - 浏览器游标/下拉/折叠行的纯派生与页面交互；
// - wcc 编译后的 session.wxml 在 ready / loading / unsupported 三种面板状态下渲染不抛错。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const contextView = require('../miniprogram/utils/context-view');
const preferences = require('../miniprogram/utils/ui-preferences');
const root = path.resolve(__dirname, '../miniprogram');
const compiler = process.env.WECHAT_WCC
  || 'D:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe';

function sampleBrowserValue(overrides) {
  const requests = [];
  // Six requests: enough for the 5th-column step flag to render in the template.
  for (let i = 0; i < 6; i += 1) {
    requests.push({
      seq: 10 + i * 10,
      time: 1791807408490 + i * 1000,
      turn: i + 1,
      step: 1,
      system: 2154,
      tools: 10439 + i,
      user: 123,
      inject: 0,
      skill: 0,
      assistant: 900,
      tool: 300,
      total: 13916 + i,
      items: { system: 1, tools: 79 + i, user: 2 },
      prompt: 11200 + i * 10,
      output: 191 + i
    });
  }
  return Object.assign({
    v: 2,
    model: 'glm-5.3-flash',
    provider: 'zaicoding',
    contextWindow: 262144,
    current: { system: 2154, tools: 10439, user: 123, inject: 0, skill: 0, assistant: 900, tool: 300, total: 13916 },
    counts: { humanInputs: 12, answers: 4, toolCalls: 43, skillLoads: 0, injects: 7, compactions: 1, prunes: 2 },
    tools: { total: 43, names: [{ name: 'bash', count: 21 }, { name: 'read', count: 12 }] },
    timing: {
      wallMs: 60000, ttftMs: 2000, reasoningMs: 1000, textMs: 3000,
      toolArgMs: 500, toolsMs: 4000, otherMs: 100,
      waitCount: 4, reasoningCount: 3, textCount: 3, toolArgCount: 4, toolCount: 5,
      speedTokens: 900, speedMs: 3000
    },
    spans: [[0, 1000, 2000], [1, 2000, 2500], [2, 2500, 4000], [3, 4000, 4200], [4, 4200, 5000], [5, 5000, 5050]],
    lastAnswer: '同步完成。',
    requests: requests,
    events: [{ seq: 20, time: 1791807500000, kind: 'compaction', tokens: 1024 }],
    // Live surface the DNA face reads, in storage order (not reading order).
    surface: [
      { seq: 60, cat: 'tool', tokens: 300 },
      { seq: 10, cat: 'user', tokens: 123 },
      { seq: 20, cat: 'assistant', tokens: 900 },
      { seq: 30, cat: 'inject', tokens: 40 }
    ],
    usage: { uncachedInputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 50, outputTokens: 80 },
    breakdown: { systemTokens: 2154, toolsTokens: 10439, messageTokens: 1323 }
  }, overrides || {});
}

// ---------- 页面交互（与 tests/context-fleet-view.test.js 相同的加载方式） ----------

function pageFixture() {
  const file = path.resolve(__dirname, '../miniprogram/pages/session/session.js');
  let definition;
  const calls = [];
  const setDataPatches = [];
  const panelPrefs = { value: { context: true, fleet: true }, read() { return { ...this.value }; } };
  const wx = { hideKeyboard() {}, nextTick: fn => fn() };
  const store = {
    state: { sessions: [], archivedSessionIds: [], connection: 'connected' },
    sessionState: {
      sessionId: 'session-1',
      running: true,
      contextFleet: null,
      contextDashboard: { loading: false, error: null, code: '', unsupported: false, asOfSeq: 3, value: sampleBrowserValue() }
    },
    openSession: (...args) => calls.push(['open', ...args]),
    loadOlderHistory: () => calls.push(['loadOlderHistory']),
    setFleetActive: active => calls.push(['fleetActive', active]),
    setContextActive: active => calls.push(['contextActive', active]),
    setTrajectoryActive: active => calls.push(['trajectoryActive', active]),
    refreshContextDashboard: () => calls.push(['refreshDashboard']),
    refreshContextFleet: () => calls.push(['refreshFleet']),
    client: {}
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; }, wx, console,
    setTimeout: () => 1, clearTimeout: () => {},
    require: name => name.endsWith('/store') ? store
      : name.endsWith('/haptics') ? { vibrate: () => calls.push(['haptic']), tick: () => calls.push(['tick']) }
        : name.endsWith('/context-panels-pref') ? panelPrefs
        : require(path.resolve(path.dirname(file), name))
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      setDataPatches.push(patch);
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let target = this.data;
        parts.slice(0, -1).forEach((part, i) => {
          if (target[part] == null) target[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
          target = target[part];
        });
        target[parts.at(-1)] = value;
      }
      if (typeof callback === 'function') callback();
    },
    startScrollPolling() {}, stopScrollPolling() {}, refreshBottomAnchor() {}
  };
  return { page, calls, setDataPatches, store, panelPrefs, wx };
}

test('long context histories auto-open overview once at the upstream 200-request threshold', () => {
  const { page, store } = pageFixture();
  const requests = Array.from({ length: 199 }, (_, index) => ({
    seq: index + 1, time: 1791807408490 + index * 1000, turn: Math.floor(index / 12) + 1,
    step: index % 12 + 1, system: 100, tools: 200, total: 300
  }));
  store.sessionState.contextDashboard.value.requests = requests;
  assert.equal(page.contextTrendAutoOverviewPatch(store.sessionState), null);

  requests.push({ seq: 200, time: 1791807608490, turn: 17, step: 1, system: 100, tools: 200, total: 300 });
  const autoPatch = page.contextTrendAutoOverviewPatch(store.sessionState);
  assert.deepEqual(Object.assign({}, autoPatch), {
    contextTrendOverview: true,
    contextTrendDna: false,
    contextTrendAdaptive: false,
    contextTrendVisibleRange: null
  });
  const panel = page.contextPanelPatch(store.sessionState, store.state, autoPatch).contextPanel;
  assert.equal(panel.trend.overview, true);
  assert.equal(panel.trend.count, 200, 'overview retains every request rather than collapsing steps');

  // A deliberate manual toggle after the auto-switch sticks for this session.
  page.setData(Object.assign({}, page.contextPanelPatch(store.sessionState, store.state, autoPatch), autoPatch));
  page.contextTrendDna();
  assert.equal(page.data.contextTrendOverview, false);
  assert.equal(page.data.contextPanel.trend.dna, true);
  assert.equal(page.data.contextPanel.browser.dna, true);
  assert.equal(page.contextTrendAutoOverviewPatch(store.sessionState), null);
  assert.equal(page._contextTrendOverviewAutoFired['session-1'], true);

  const secondSession = Object.assign({}, store.sessionState, { sessionId: 'session-2' });
  assert.equal(page.contextTrendAutoOverviewPatch(secondSession).contextTrendOverview, true);
});

test('statistics flow computes four visible animated connector paths from measured nodes', () => {
  const { page, wx } = pageFixture();
  page.data.tab = 'context';
  wx.createSelectorQuery = () => {
    const results = [
      { left: 20, top: 100, width: 375, height: 600 },
      { left: 32, top: 130, width: 155, height: 100 },
      { left: 220, top: 130, width: 155, height: 100 },
      { left: 60, top: 330, width: 255, height: 100 },
      { left: 32, top: 530, width: 155, height: 60 },
      { left: 220, top: 530, width: 155, height: 60 }
    ];
    const query = {
      in() { return this; },
      select() { return { boundingClientRect() { return query; } }; },
      exec(callback) { callback(results); }
    };
    return query;
  };
  page.drawContextFlow();
  const links = page.data.contextFlowLinks;
  assert.ok(links.length > 4, 'curves are decomposed into native segments');
  assert.deepEqual(new Set(links.filter(item => item.kind === 'glow').map(item => item.style.match(/background:([^;]+)/)[1])),
    new Set(['#00C950', '#AD46FF', '#00BBA7', '#F6339A']));
  assert.ok(links.some(item => item.kind === 'dash' && item.style.includes('animation-delay')));
  assert.deepEqual(new Set(links.map(item => item.pathKey)), new Set([
    '#ctxNodeInputs>#ctxNodeSession', '#ctxNodeEvents>#ctxNodeSession',
    '#ctxNodeTools>#ctxNodeSession', '#ctxNodeNet>#ctxNodeSession'
  ]), 'all surrounding modules feed into the current session');
  for (const pathKey of new Set(links.map(item => item.pathKey))) {
    assert.equal(links.filter(item => item.pathKey === pathKey && item.kind === 'glow').length, 40,
      'each ribbon is sampled densely enough to look continuous');
    const dashes = links.filter(item => item.pathKey === pathKey && item.kind === 'dash');
    assert.equal(dashes.length, 10, 'spaced dash segments sit on top of the smooth ribbon');
    assert.ok(dashes.every((item, index) => index === 0
      || Number(item.style.match(/animation-delay:(\d+)ms/)[1]) > Number(dashes[index - 1].style.match(/animation-delay:(\d+)ms/)[1])),
    'successive dashes light toward the central session');
  }
  const styles = fs.readFileSync(path.resolve(root, 'pages/session/session.wxss'), 'utf8');
  // 会话节点按 dsh-context 改成两行 kv（17px/700），不再是 2×2 metric 网格。
  assert.match(styles, /\.ctx-flow-self-stats\s*\{\s*display:\s*flex/);
  assert.match(styles, /\.ctx-flow-kv-value\s*\{\s*font-size:\s*34rpx;\s*font-weight:\s*700/);
  assert.match(styles, /\.theme-dark \.ctx-flow-self\s*\{[^}]*border-color:\s*rgba\(249, 250, 251, \.40\)/s);
});

test('browser cursor handlers walk requests and reset to the current composition', () => {
  const { page } = pageFixture();
  page.data.tab = 'context';
  page.setData(page.contextPanelPatch());
  const browser = page.data.contextPanel.browser;
  assert.equal(browser.isCurrent, false);
  assert.equal(browser.selectedSeq, 60, 'the browser initially follows the latest trend bar');
  assert.equal(browser.selectedIndex, browser.options.length - 2);
  // 上一步 → 跟随趋势退到较早请求（seq 50）。
  page.contextBrowserStep({ currentTarget: { dataset: { step: '-1' } } });
  assert.equal(page.data.contextBrowserSeq, 50);
  assert.equal(page.data.contextPanel.browser.isCurrent, false);
  assert.equal(page.data.contextPanel.browser.promptText, '11.2k');
  // 继续往更早走。
  page.contextBrowserStep({ currentTarget: { dataset: { step: '-1' } } });
  assert.equal(page.data.contextBrowserSeq, 40);
  // 下一步回到更新的请求，最后回到「当前（下一次请求）」。
  page.contextBrowserStep({ currentTarget: { dataset: { step: '1' } } });
  assert.equal(page.data.contextBrowserSeq, 50);
  page.contextBrowserStep({ currentTarget: { dataset: { step: '1' } } });
  assert.equal(page.data.contextPanel.browser.selectedSeq, 60);
  page.contextBrowserStep({ currentTarget: { dataset: { step: '1' } } });
  assert.equal(page.data.contextBrowserSeq, null);
  assert.equal(page.data.contextBrowserIsCurrent, true);
  assert.equal(page.data.contextPanel.browser.isCurrent, true);
  assert.equal(page.data.contextPanel.browser.canNext, false);
});

test('DNA selection stays active and opens a detailed browser feed for the selected request', () => {
  const { page, store, setDataPatches } = pageFixture();
  store.sessionState.contextDashboard.value.surface.push({ seq: 55, cat: 'user', tokens: 0, name: 'empty-but-read' });
  page.data.tab = 'context';
  page.setData(page.contextPanelPatch());
  setDataPatches.length = 0;
  page.contextTrendDna();
  assert.equal(setDataPatches.length, 1, 'mode, selected request and browser update atomically');
  assert.equal(page.data.contextPanel.trend.dna, true);
  assert.equal(page.data.contextPanel.browser.dna, true);
  assert.equal(page.data.contextPanel.browser.selectedSeq, 60);
  assert.deepEqual(page.data.contextPanel.browser.dnaRows.map(row => row.seq), [10, 20, 30, 55, 60]);
  assert.deepEqual(page.data.contextPanel.browser.dnaRows.map(row => row.category), ['user', 'assistant', 'inject', 'user', 'tool']);
  assert.ok(page.data.contextPanel.browser.dnaRows.every(row => row.tokenText && row.label && row.posText && row.stamp !== undefined));

  const template = fs.readFileSync(path.resolve(root, 'pages/session/session.wxml'), 'utf8');
  assert.match(template, /ctx-gran-btn \{\{contextPanel\.browser\.dna \? 'on' : ''\}\}/);
  assert.match(template, /aria-pressed="\{\{contextPanel\.browser\.dna\}\}"/);
  assert.match(template, /class="ctx-br-scroll ctx-trend-dna"/);

  page.contextTrendSelect({ currentTarget: { dataset: { seq: '20' } } });
  assert.equal(page.data.contextPanel.trend.selectedSeq, 20);
  assert.equal(page.data.contextPanel.browser.selectedSeq, 20);
  assert.deepEqual(page.data.contextPanel.browser.dnaRows.map(row => row.seq), [10, 20]);

  page.contextTrendDna();
  assert.equal(page.data.contextPanel.trend.dna, false);
  assert.equal(page.data.contextPanel.browser.dna, false, 'the browser toggle shares the chart DNA state');
});

test('overview toggle atomically renders the overview ribbon and clears the DNA browser', () => {
  const { page, setDataPatches } = pageFixture();
  page.data.tab = 'context';
  page.setData(page.contextPanelPatch());
  page.contextTrendDna();
  setDataPatches.length = 0;

  page.contextTrendOverview();
  assert.equal(setDataPatches.length, 1, 'overview mode and its linked browser selection update atomically');
  assert.equal(page.data.contextPanel.trend.overview, true);
  assert.equal(page.data.contextPanel.trend.dna, false);
  assert.ok(page.data.contextPanel.trend.ribbon.columns.length > 0);
  assert.ok(page.data.contextPanel.trend.ribbon.columns.every(column => column.segments.length > 0));
  assert.equal(page.data.contextPanel.browser.dna, false);
  assert.equal(page.data.contextBrowserSeq, page.data.contextPanel.trend.selectedSeq);

  const styles = fs.readFileSync(path.resolve(root, 'pages/session/session.wxss'), 'utf8');
  for (const category of ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool']) {
    assert.match(styles, new RegExp('\\.ctx-c-' + category + '\\s*\\{'))
  }
});

test('browser picker jumps to the chosen request and the fold rows toggle', () => {
  const { page } = pageFixture();
  page.data.tab = 'context';
  page.setData(page.contextPanelPatch());
  page.contextBrowserPick({ detail: { value: '0' } });
  assert.equal(page.data.contextBrowserSeq, 10);
  assert.equal(page.data.contextPanel.browser.selectedLabel, '请求 #10');
  const row = page.data.contextPanel.browser.rows[1];
  assert.equal(row.expanded, false);
  page.toggleContextBrowserRow({ currentTarget: { dataset: { key: row.key } } });
  assert.deepEqual([...page.data.contextBrowserExpanded], ['tools']);
  assert.equal(page.data.contextPanel.browser.rows[1].expanded, true);
  page.toggleContextBrowserRow({ currentTarget: { dataset: { key: row.key } } });
  assert.deepEqual([...page.data.contextBrowserExpanded], []);
  assert.equal(page.data.contextPanel.browser.rows[1].expanded, false);
});

test('browser handlers survive a panel without browser data (loading/error states)', () => {
  const { page, calls } = pageFixture();
  page.data.contextPanel = contextView.buildPanel(null, { connected: true, hasSession: true });
  page.contextBrowserStep({ currentTarget: { dataset: { step: '-1' } } });
  page.contextBrowserStep({ currentTarget: { dataset: { step: '1' } } });
  page.contextBrowserPick({ detail: { value: 0 } });
  page.toggleContextBrowserRow({ currentTarget: { dataset: { key: 'system' } } });
  assert.equal(page.data.contextBrowserSeq, null);
  assert.deepEqual([...page.data.contextBrowserExpanded], []);
  assert.equal(calls.filter(call => call[0] === 'refreshDashboard').length, 0);
});

test('file activity filter and sort controls update the visible file list', () => {
  const { page, store } = pageFixture();
  store.sessionState.contextDashboard.value.fileOps = [
    { seq: 1, time: 100, path: 'src/a.js', kind: 'read' },
    { seq: 2, time: 200, path: 'src/a.js', kind: 'write', added: 2 },
    { seq: 3, time: 300, path: 'tests/a.js', kind: 'search' }
  ];
  page.setData(page.contextPanelPatch());
  page.setContextFileFilter({ currentTarget: { dataset: { filter: 'write' } } });
  assert.deepEqual(page.data.contextPanel.files.rows.map(row => row.path), ['src/a.js']);
  assert.equal(page.data.contextPanel.files.filter, 'write');
  page.setContextFileFilter({ currentTarget: { dataset: { filter: 'search' } } });
  assert.deepEqual(page.data.contextPanel.files.rows.map(row => row.path), ['tests/a.js']);
  page.setContextFileFilter({ currentTarget: { dataset: { filter: 'all' } } });
  page.setContextFileSort({ currentTarget: { dataset: { sort: 'latest' } } });
  assert.deepEqual(page.data.contextPanel.files.rows.map(row => row.path), ['tests/a.js', 'src/a.js']);
});

test('stats chips jump to the matching browser and file filter (event pills stay inert)', () => {
  const { page, store } = pageFixture();
  store.sessionState.contextDashboard.value.activity = { userInputs: 1, reads: 2, writes: 1, searches: 0, images: 0 };
  store.sessionState.contextDashboard.value.events.push({ seq: 99, time: 1791807501000, kind: 'prune', tokens: 10 });

  page.contextStatsJump({ currentTarget: { dataset: { key: 'reads' } } });
  assert.equal(page.data.contextFileFilter, 'read');
  assert.equal(page.data.contextScrollTarget, 'ctxFileCard');

  // 事件胶囊在插件里不是链接：点击不筛选、不跳转（dsh-context statsContext §3.4）。
  page.contextStatsJump({ currentTarget: { dataset: { key: 'prune' } } });
  assert.equal(page.data.contextEventFilter, null);
  assert.equal(page.data.contextScrollTarget, 'ctxFileCard');

  page.contextStatsJump({ currentTarget: { dataset: { key: 'userInputs' } } });
  assert.equal(page.data.contextBrowserSeq, 60);
  assert.equal(page.data.contextScrollTarget, 'ctxBrowserCard');
});

test('context content opens are deduplicated and preserve the host truncation marker', async () => {
  const { page, store } = pageFixture();
  let resolveContent;
  let requests = 0;
  store.client.requestContextContent = () => {
    requests += 1;
    return new Promise(resolve => { resolveContent = resolve; });
  };
  const event = { currentTarget: { dataset: { seq: '10' } } };
  page.openContextNode(event);
  page.openContextNode(event);
  assert.equal(requests, 1);
  resolveContent({ value: { type: 'user/message', text: 'long content', truncated: true } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(page.data.contextNodeDetail.text, 'long content');
  assert.equal(page.data.contextNodeDetail.truncated, true);
  assert.equal(page.data.contextNodeLoadingSeq, null);
});

test('trend selection and the context browser stay linked in both directions', () => {
  const { page } = pageFixture();
  page.data.tab = 'context';
  page.setData(page.contextPanelPatch());

  // 默认浏览器跟随趋势图最新一条；「当前（下一次请求）」仍可单独选取。
  assert.equal(page.data.contextPanel.browser.selectedSeq, 60);
  assert.equal(page.data.contextPanel.trend.selectedSeq, 60);

  // 点趋势柱 → 浏览器跟着切到同一请求，展开它的实际拼接内容。
  page.contextTrendSelect({ currentTarget: { dataset: { seq: '20' } } });
  assert.equal(page.data.contextTrendSeq, 20);
  assert.equal(page.data.contextBrowserSeq, 20, 'the browser follows the bar');
  assert.equal(page.data.contextPanel.browser.isCurrent, false);
  assert.equal(page.data.contextPanel.trendDetail.seq, 20);

  // 浏览器后退一步 → 趋势图选中项回写，不会形成往返抖动。
  page.contextBrowserStep({ currentTarget: { dataset: { step: '-1' } } });
  assert.equal(page.data.contextBrowserSeq, 10);
  assert.equal(page.data.contextPanel.trend.selectedSeq, 10, 'the bar follows the browser');

  // 下拉跳到另一条 → 两边仍一致。
  page.contextBrowserPick({ detail: { value: '3' } });
  assert.equal(page.data.contextBrowserSeq, 40);
  assert.equal(page.data.contextPanel.trend.selectedSeq, 40);

  // 再点一次取消固定，趋势与浏览器一起回到最新历史请求。
  page.contextTrendSelect({ currentTarget: { dataset: { seq: '40' } } });
  assert.equal(page.data.contextTrendSeq, null);
  assert.equal(page.data.contextPanel.browser.selectedSeq, 60);
  assert.equal(page.data.contextPanel.browser.isCurrent, false);
  assert.equal(page.data.contextPanel.trend.selectedSeq, page.data.contextPanel.browser.selectedSeq);
});

test('trend controls select a request, change grouping, and switch to delta mode', () => {
  const { page } = pageFixture();
  page.data.tab = 'context';
  page.setData(page.contextPanelPatch());
  assert.equal(page.data.contextPanel.trend.groupBy, 'step');
  assert.equal(page.data.contextPanel.trend.displayMode, 'total');
  assert.equal(page.data.contextPanel.trend.selectedSeq, 60);

  page.contextTrendSelect({ currentTarget: { dataset: { seq: '20' } } });
  assert.equal(page.data.contextPanel.trend.selectedSeq, 20);
  assert.equal(page.data.contextPanel.trendDetail.seq, 20);
  assert.equal(page.data.contextPanel.trendDetail.actualPromptText, '11.2k');
  page.contextTrendGroup({ currentTarget: { dataset: { group: 'step' } } });
  assert.equal(page.data.contextPanel.trend.selectedSeq, 20, 'tapping the active auto-resolved group keeps the selection');

  page.contextTrendGroup({ currentTarget: { dataset: { group: 'turn' } } });
  assert.equal(page.data.contextTrendSeq, 20);
  assert.equal(page.data.contextPanel.trend.groupBy, 'turn');
  assert.equal(page.data.contextPanel.trendDetail.seq, 20);
  page.contextTrendMode({ currentTarget: { dataset: { mode: 'delta' } } });
  assert.equal(page.data.contextPanel.trend.displayMode, 'delta');
  // Delta geometry is px primitives now: the two arms always sum to the plot height.
  assert.equal(
    page.data.contextPanel.trend.upPx + page.data.contextPanel.trend.downPx,
    contextView.TREND_CHART_H
  );
  assert.ok(page.data.contextPanel.trend.bars[0].growth > 0);
  assert.equal(page.data.contextPanel.trend.bars[0].growthText.charAt(0), '+');
  // The turn strip rides the same grid in both granularities.
  assert.ok(page.data.contextPanel.trend.turnStrip.length > 0);
  // Switching to delta drops DNA, which has no signed change to show.
  page.contextTrendDna();
  assert.equal(page.data.contextTrendDna, true);
  page.contextTrendMode({ currentTarget: { dataset: { mode: 'total' } } });
  assert.equal(page.data.contextPanel.trend.displayMode, 'total');
  assert.equal(page.data.contextPanel.trend.dna, true);
  assert.ok(page.data.contextPanel.trend.bars[0].dna !== null);
  assert.ok(page.data.contextPanel.trend.bars[0].dna.length > 0);
  page.contextTrendMode({ currentTarget: { dataset: { mode: 'delta' } } });
  assert.equal(page.data.contextPanel.trend.dna, false, 'delta mode cannot show DNA bands');
  assert.equal(page.data.contextPanel.trend.bars[0].dna, null);

  // The overview is the other face of the same chart: turning it on clears DNA.
  page.contextTrendOverview();
  assert.equal(page.data.contextTrendOverview, true);
  assert.equal(page.data.contextTrendDna, false);
  assert.equal(page.data.contextPanel.trend.overview, true);
  assert.equal(page.data.contextPanel.trend.dna, false);
  assert.equal(page.data.contextPanel.trend.ribbon.count, page.data.contextPanel.trend.count);
  assert.ok(page.data.contextPanel.trend.ribbon.columns.length > 0);
  assert.equal(page.data.contextBrowserSeq, page.data.contextPanel.trend.selectedSeq, 'the browser stays on the bar selected by the overview');
  // Turning DNA back on drops the overview.
  page.contextTrendDna();
  assert.equal(page.data.contextTrendDna, true);
  assert.equal(page.data.contextTrendOverview, false);
});

test('adaptive, duration, overview, turn selection and context browser stay in sync', () => {
  const { page } = pageFixture();
  page.data.tab = 'context';
  page.setData(page.contextPanelPatch());

  page.contextTrendAdaptive();
  assert.equal(page.data.contextPanel.trend.adaptive, true);
  assert.equal(page.data.contextPanel.trend.overview, false);
  assert.equal(page.data.contextBrowserSeq, page.data.contextPanel.trend.selectedSeq);

  page.contextTrendDuration();
  assert.equal(page.data.contextPanel.trend.showDuration, false);
  assert.equal(page.data.contextPanel.trend.hasDuration, false);
  page.contextTrendDuration();
  assert.equal(page.data.contextPanel.trend.showDuration, true);

  page.contextTrendOverview();
  assert.equal(page.data.contextPanel.trend.overview, true);
  assert.equal(page.data.contextPanel.trend.adaptive, false, 'overview replaces adaptive scaling');
  assert.equal(page.data.contextBrowserSeq, page.data.contextPanel.trend.selectedSeq);

  page.contextTrendPickTurn({ currentTarget: { dataset: { turn: '2' } } });
  assert.equal(page.data.contextPanel.trendDetail.turnText, '第 2 轮');
  assert.equal(page.data.contextBrowserSeq, page.data.contextPanel.trend.selectedSeq);
});

test('disabled session panels disappear and an active hidden panel falls back to conversation', () => {
  const { page, calls, panelPrefs } = pageFixture();
  page.data.tab = 'context';
  panelPrefs.value.context = false;
  panelPrefs.value.fleet = false;
  assert.equal(page.syncContextPanelPreferences(), 'conversation');
  assert.equal(page.data.tab, 'conversation');
  assert.equal(page.data.showContextPanel, false);
  assert.equal(page.data.showFleetPanel, false);
  assert.ok(calls.some(call => call[0] === 'contextActive' && call[1] === false));
  assert.ok(calls.some(call => call[0] === 'fleetActive' && call[1] === false));

  page.switchTab({ currentTarget: { dataset: { tab: 'context' } } });
  page.switchTab({ currentTarget: { dataset: { tab: 'fleet' } } });
  assert.equal(page.data.tab, 'conversation', 'hidden tabs cannot be opened through stale events');
});

// ---------- 原生 WXML 渲染（ready / loading / unsupported） ----------

test('native session template renders v2 context/fleet panels without throwing', { skip: !fs.existsSync(compiler) }, () => {
  const output = path.join(os.tmpdir(), 'dsh-context-v2-' + process.pid + '.js');
  execFileSync(compiler, ['-o', output, 'pages/session/session.wxml'], { cwd: root });
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(fs.readFileSync(output, 'utf8'), context);
  const render = context.$gwx('pages/session/session.wxml');
  const snapshot = preferences.snapshot();

  const readyPanel = contextView.buildPanel(
    { loading: false, error: null, code: '', unsupported: false, asOfSeq: 5, value: sampleBrowserValue() },
    { connected: true, hasSession: true, running: true, browserSeq: 20, expanded: ['tools'], trendSeq: 20, trendGroupBy: 'step', trendDisplayMode: 'delta' }
  );
  const fleetPanel = contextView.buildFleetPanel({
    loading: false,
    error: null,
    code: '',
    unsupported: false,
    asOfSeq: 6,
    value: {
      rootSessionId: 'session-1',
      currentSessionId: 'session-1',
      counts: { agents: 2, running: 1, subagents: 1 },
      agents: [
        { sessionId: 'session-1', title: '主会话', depth: 0, isRoot: true, running: true, phase: 'active', lastAnswer: '正在同步', contextWindow: 1000, pressureTokens: 250, tokensTotal: 500, turns: 2, steps: 4, activeMs: 60000, composition: { system: 10, tools: 5, user: 3, total: 18 } },
        { sessionId: 'session-child', title: '子会话', depth: 1, running: false, phase: 'idle', lastAnswer: '子任务完成' }
      ],
      team: { members: [{ id: 'session-1', role: 'lead', phase: 'active' }], tasks: [{ id: 't1', subject: '实现组件', status: 'in_progress', ownerName: '阿青' }] }
    }
  }, { connected: true, hasSession: true, running: true });

  const base = {
    ...snapshot,
    tab: 'context',
    showContextPanel: true,
    showFleetPanel: true,
    theme: 'light',
    themeClass: '',
    contextMounted: true,
    fleetMounted: true,
    contextFlowLinks: [{ key: 'flow-test', kind: 'glow', style: 'left:1px;top:2px;width:10px;' }],
    contextFlowW: 320, contextFlowH: 600,
    rows: [], images: [], queue: [], tasks: [], folds: {},
    ui: snapshot.ui || {},
    stats: {}, commandMenu: null,
    contextPanel: readyPanel,
    fleetPanel: fleetPanel
  };
  const readyTree = JSON.stringify(render({ ...base }, {}, {}));
  assert.ok(readyTree.includes('ctx-browser'), 'browser card renders');
  assert.ok(readyTree.includes('ctx-flow-segment'), 'statistics flow uses renderable native view segments');
  assert.ok(readyTree.includes('ctx-trend-controls'), 'trend grouping and display controls render');
  assert.ok(readyTree.includes('ctx-trend-detail'), 'selected request details render');
  assert.ok(readyTree.includes('ctx-trend-deltaplot'), 'delta chart mode renders');
  assert.ok(readyTree.includes('ctx-trend-axis-tick'), 'y-axis ticks render');
  assert.ok(readyTree.includes('ctx-trend-grid'), 'grid lines render');
  assert.ok(readyTree.includes('ctx-trend-turn'), 'turn strip renders');
  assert.ok(readyTree.includes('ctx-trend-flagpole'), 'step flags render');
  const template = fs.readFileSync(path.join(root, 'pages/session/session.wxml'), 'utf8');
  assert.ok(template.indexOf('<!-- 上下文趋势 -->') < template.indexOf("ui['上下文浏览器']"), 'context browser follows the trend chart');
  assert.ok(template.includes("ui['DNA 模式']") && template.includes("ui['自适应']") && template.includes("ui['耗时']"), 'plugin trend modes are exposed');
  assert.doesNotMatch(template, /class="ctx-trend-marker(?:\s|")/, 'trend has no scissors overlay');
  assert.ok(readyTree.includes('ctx-timeline'), 'timing timeline renders');
  assert.ok(readyTree.includes('ctx-donut'), 'donuts render');
  assert.ok(readyTree.includes('fleet-answer'), 'fleet latest answer renders');
  assert.ok(readyTree.includes('fleet-task'), 'fleet task card renders');

  const loading = contextView.buildPanel({ loading: true, value: null }, { connected: true, hasSession: true });
  const loadingFleet = contextView.buildFleetPanel({ loading: true, value: null }, { connected: true, hasSession: true });
  const loadingTree = JSON.stringify(render({ ...base, contextPanel: loading, fleetPanel: loadingFleet }, {}, {}));
  assert.ok(loadingTree.length > 0);

  const unsupported = contextView.buildPanel({ unsupported: true }, { connected: true, hasSession: true });
  const unsupportedFleet = contextView.buildFleetPanel({ unsupported: true }, { connected: true, hasSession: true });
  const unsupportedTree = JSON.stringify(render({ ...base, contextPanel: unsupported, fleetPanel: unsupportedFleet }, {}, {}));
  assert.ok(unsupportedTree.includes('dsh-plugin-mobile-gateway'), 'upgrade hint renders');
});
