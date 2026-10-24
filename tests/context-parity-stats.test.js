// 上下文面板 ⇄ dsh-context v0.74.0 的视觉契约测试。
//
// 规格来源：.reference/parity/spec-stats.md（逐值来自插件 stats.css / stackedBar.css /
// statsTokens.tsx / statsTiming.tsx / timingStrip.tsx）。这里只钉住「一比一」里那些
// 容易在后续迭代中被悄悄改回的数值：调色板 hex、卡片骨架、环形/组成条/时间轴几何、
// 以及随交互变化的文案钩子。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'miniprogram');
const wxss = fs.readFileSync(path.join(root, 'pages/session/session.wxss'), 'utf8');
const wxml = fs.readFileSync(path.join(root, 'pages/session/session.wxml'), 'utf8');
const view = require(path.join(root, 'utils/context-view'));

test('palette matches dsh-context v0.74.0 (Tailwind v4 hex, not v3)', () => {
  // categories.ts 七类 + output；timingStrip 六段。
  const palette = {
    '--ctx-c-system': '#615FFF',
    '--ctx-c-tools': '#FE9A00',
    '--ctx-c-user': '#00C950',
    '--ctx-c-inject': '#AD46FF',
    '--ctx-c-skill': '#FF6900',
    '--ctx-c-assistant': '#2B7FFF',
    '--ctx-c-tool': '#00BBA7',
    '--ctx-c-output': '#F6339A',
    '--ctx-t-wait': '#2B7FFF',
    '--ctx-t-reasoning': '#8E51FF',
    '--ctx-t-text': '#F6339A',
    '--ctx-t-toolarg': '#FE9A00',
    '--ctx-t-tools': '#00BBA7',
    '--ctx-t-other': '#90A1B9'
  };
  const sessionRule = wxss.match(/\.session\{([^}]*)\}/);
  assert.ok(sessionRule, 'the session scope carries the context palette');
  for (const [token, hex] of Object.entries(palette)) {
    assert.ok(sessionRule[1].includes(token + ':' + hex), token + ' must be ' + hex);
  }
  // 窗口轨道与两段预留遮罩底色（stackedBar.css / reserve.ts）。
  assert.ok(sessionRule[1].includes('--ctx-window-rest:rgba(115,115,115,.18)'));
  assert.ok(sessionRule[1].includes('--ctx-window-reserve:rgba(65,118,230,.24)'));
});

test('card skeleton follows .lc-card inside .lc-root (padding 7x8px, radius 10px, title 13px)', () => {
  assert.match(wxss, /\.ctx-card\s*\{[^}]*padding:\s*14rpx 16rpx/);
  assert.match(wxss, /\.ctx-card\s*\{[^}]*border-radius:\s*20rpx/);
  assert.match(wxss, /\.ctx-card-title\s*\{[^}]*font-size:\s*26rpx;\s*font-weight:\s*600/);
  assert.match(wxss, /\.ctx-card-head\s*\{[^}]*gap:\s*16rpx;\s*margin-bottom:\s*20rpx/);
});

test('token donut is 96px with an 8-row slice grid and a cached-hit rate chip', () => {
  assert.match(wxss, /\.ctx-donut\s*\{[^}]*width:\s*192rpx;\s*height:\s*192rpx/);
  assert.match(wxss, /\.ctx-donut-hole\s*\{[^}]*inset:\s*18rpx/);
  assert.match(wxss, /\.ctx-slice-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(150px,\s*100%\),\s*1fr\)\)/);
  assert.match(wxml, /class="ctx-card-rate"[^>]*data-tip="cacheHit"/);
  assert.match(wxml, /contextPanel\.tokens\.hitText/);
  // output 行用 provider 精确值 + 「含思考」，prompt 侧才是 ≈。
  const tokens = view.deriveTokens({
    current: { system: 100, tools: 50, user: 10, inject: 10, skill: 10, assistant: 10, tool: 10 },
    usage: { uncachedInputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 100, outputTokens: 60 }
  }, key => key);
  const output = tokens.rows[tokens.rows.length - 1];
  assert.equal(output.estimate, false);
  assert.equal(output.subText, '60 · 含思考');
  assert.equal(tokens.hitText, '33.33');
  assert.equal(tokens.centerSub, '总用量');
});

test('current composition renders a 16px bar with two 45-degree reserve masks and a trigger line', () => {
  assert.match(wxss, /\.ctx-compose-bar\s*\{[^}]*height:\s*32rpx/);
  assert.match(wxss, /\.ctx-mask-headroom\s*\{[^}]*repeating-linear-gradient\(45deg,\s*rgba\(245,\s*158,\s*11,\s*\.24\)\s*0 5px,\s*transparent 5px 10px\)/);
  assert.match(wxss, /\.ctx-mask-output\s*\{[^}]*repeating-linear-gradient\(45deg,\s*rgba\(65,\s*118,\s*230,\s*\.24\)\s*0 5px,\s*transparent 5px 10px\)/);
  assert.match(wxss, /\.theme-dark \.ctx-mask-output\s*\{[^}]*rgba\(122,\s*170,\s*255,\s*\.24\)/);
  assert.match(wxss, /\.ctx-compose-trigger::after\s*\{[^}]*width:\s*2px/);
  assert.match(wxml, /ctx-compose-trigger/);
  // 大号数值 + 窗口后缀 + 右侧一位小数占用率。
  const current = view.deriveCurrent({
    current: { system: 100, tools: 200, user: 50, inject: 20, skill: 10, assistant: 400, tool: 20, total: 800 },
    contextWindow: 1000
  }, key => key);
  assert.equal(current.numText, '800');
  assert.equal(current.windowSuffix, '/ 1.0k tokens');
  assert.equal(current.occupancyText, '80.0%');
  assert.ok(current.headroomMask === null || current.headroomMask.width >= 0);
  assert.equal(current.rows.length, 7);
});

test('current composition legend and bar highlight one category on tap', () => {
  const base = view.deriveCurrent({
    current: { system: 100, tools: 200, user: 50, total: 350 },
    contextWindow: 1000
  }, key => key);
  const picked = view.deriveCurrent({
    current: { system: 100, tools: 200, user: 50, total: 350 },
    contextWindow: 1000
  }, key => key, null, 'tools');
  assert.equal(base.rows.find(row => row.key === 'tools').active, false);
  assert.equal(picked.rows.find(row => row.key === 'tools').active, true);
  assert.equal(picked.rows.find(row => row.key === 'tools').dim, false);
  assert.equal(picked.rows.find(row => row.key === 'system').dim, true);
  assert.equal(picked.barSegments.find(segment => segment.key === 'tools').active, true);
  assert.match(wxss, /\.ctx-slice\.dim\s*\{[^}]*opacity:\s*\.45/);
  assert.match(wxss, /\.ctx-compose-seg\.dim\s*\{[^}]*opacity:\s*\.35/);
  assert.match(wxml, /bindtap="contextCurrentTap" data-key="\{\{item\.key\}\}"/);
  const session = fs.readFileSync(path.join(root, 'pages/session/session.js'), 'utf8');
  assert.match(session, /contextCurrentTap\(e\)[\s\S]*?contextCurrentHighlight/);
});

test('timing card paints a 6-slice ring with real durations, TPS chip and a compact strip with quartile ticks', () => {
  assert.match(wxml, /contextPanel\.timing\.rows/);
  assert.match(wxml, /contextPanel\.timing\.timelineTicks/);
  assert.match(wxml, /data-tip="tps"/);
  assert.match(wxss, /\.ctx-tstrip-bar\s*\{[^}]*height:\s*24rpx/);
  assert.match(wxss, /\.ctx-tstrip-tick-last\s*\{[^}]*translateX\(-100%\)/);
  const timing = view.deriveTiming({
    timing: { wallMs: 10000, ttftMs: 1000, reasoningMs: 3000, textMs: 1000, toolArgMs: 1000, toolsMs: 3000, otherMs: 0,
      waitCount: 1, reasoningCount: 2, textCount: 2, toolArgCount: 1, toolCount: 2, speedTokens: 1000, speedMs: 2000 },
    counts: { answers: 3, toolCalls: 2 }
  }, key => key);
  assert.deepEqual(timing.rows.map(row => row.key), ['wait', 'reasoning', 'text', 'toolarg', 'tools', 'other']);
  assert.deepEqual(timing.rows.map(row => row.pctText), ['10.0%', '30.0%', '10.0%', '10.0%', '30.0%', '10.0%']);
  assert.equal(timing.speedText, '500 tok/s');
  const strip = view.deriveTimeline({ spans: [[0, 0, 2000], [1, 2000, 6000]] });
  assert.equal(strip.hasData, true);
  assert.deepEqual(strip.items.map(item => item.style), ['left:0.00%;width:33.33%;', 'left:33.33%;width:66.67%;']);
  assert.deepEqual(strip.ticks.map(tick => tick.text), ['0', '1.5s', '3.0s', '4.5s', '6.0s']);
});
