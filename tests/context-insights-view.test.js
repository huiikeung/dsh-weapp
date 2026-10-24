// Context Insights 页 ⇄ dsh-context v0.74.0 契约（spec-fleet.md §12）。
//
// 页面：KPI 带（会话/Token/缓存命中/轮次/工具调用/活跃时长）、近 7 天柱图、
// 8 周热力图、上下文组成环 + 图例、会话卡片（标题/用量/轮次/工具/活跃/组成条/占用%）。
// 宿主侧 context-insights 聚合在 tests/context-bridge.test.js 里覆盖。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'miniprogram');
const pageDir = path.join(root, 'pages/insights');
const view = require(path.join(root, 'pages/insights/utils/context-insights-view'));
const wxml = fs.readFileSync(path.join(pageDir, 'insights.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(pageDir, 'insights.wxss'), 'utf8');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));

const t = (key, values) => (values
  ? Object.keys(values).reduce((text, name) => text.split('{' + name + '}').join(String(values[name])), key)
  : key);

const DAY = 86400000;
const now = new Date(2026, 9, 23, 12, 0, 0).getTime();
function dayKey(offset) {
  const date = new Date(now - offset * DAY);
  const pad = (value) => (value < 10 ? '0' + value : String(value));
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function value() {
  const days = [];
  for (let offset = 55; offset >= 0; offset -= 1) {
    days.push({ day: dayKey(offset), tokens: offset === 0 ? 900 : offset < 7 ? 300 - offset * 10 : 0 });
  }
  return {
    v: 1,
    asOf: now,
    days,
    sessions: [
      { id: 's1', title: '近的会话', model: 'm1', provider: 'p1', lastActive: now - DAY, billedTokens: 12000, inputTokens: 10000, outputTokens: 2000, cacheReadTokens: 8000, turns: 5, steps: 9, toolCalls: 7, activeMs: 125000, contextWindow: 1000, pressureTokens: 850, composition: { system: 100, tools: 200, user: 100, output: 50 } },
      { id: 's2', title: '四十天前的会话', model: 'm2', provider: 'p2', lastActive: now - 40 * DAY, billedTokens: 3000, inputTokens: 3000, cacheReadTokens: 0, turns: 1, steps: 2, toolCalls: 1, activeMs: 65000, contextWindow: 1000, pressureTokens: 500, composition: { system: 50, assistant: 50 } }
    ]
  };
}

test('range chips filter sessions and recompute KPIs', () => {
  const week = view.deriveInsights(value(), 7, t, now);
  assert.deepEqual(week.ranges.map(range => range.key), ['today', '7', '30', '0']);
  assert.equal(week.ranges.find(range => range.active).key, '7');
  assert.equal(week.cards.length, 1, 'only the session active within 7 days');
  assert.deepEqual(week.kpi.map(kpi => kpi.key), ['sessions', 'tokens', 'cost', 'cache', 'tools', 'wall']);
  assert.equal(week.kpi[0].valueText, '1');
  assert.equal(week.kpi[1].valueText, '12.0k');
  assert.equal(week.kpi.find(item => item.key === 'cache').valueText, '80.0%');
  assert.equal(week.ring.totalText, '12.0k', 'the ring uses billed input proportions plus exact provider output');
  const all = view.deriveInsights(value(), 0, t, now);
  assert.equal(all.cards.length, 2);
  assert.equal(all.kpi[0].valueText, '2');
});

test('7-day bars and the 8-week heatmap share the daily buckets', () => {
  const panel = view.deriveInsights(value(), 7, t, now);
  assert.equal(panel.weekly.length, 7);
  assert.equal(Math.max(...panel.weekly.map(day => day.height)), 100);
  const cells = panel.heatmap.weeks.flatMap(week => week.cells);
  assert.equal(cells.length, 56);
  assert.equal(cells[cells.length - 1].level, 4);
  assert.equal(cells[0].level, 0);
  assert.match(wxss, /\.ins-heat-lv4\s*\{[^}]*rgba\(46,\s*107,\s*230,\s*\.85\)/);
  assert.match(wxml, /ins-heat-cell/);
});

test('composition ring reuses the context palette and keeps zero rows dim', () => {
  const panel = view.deriveInsights(value(), 7, t, now);
  assert.equal(panel.ring.available, true);
  assert.match(panel.ring.style, /^background:conic-gradient\(/);
  assert.match(panel.ring.style, /var\(--ctx-c-system\)/);
  assert.equal(panel.ring.rows.length, 8);
  assert.equal(panel.ring.rows.find(row => row.key === 'skill').dim, true);
  assert.match(wxss, /\.ins-ring\s*\{[^}]*border-radius:\s*50%/);
  assert.match(wxml, /ctx-dot ctx-c-\{\{item\.key\}\}/);
});

test('session cards expose billed tokens, turns, tools, activity and occupancy colour', () => {
  const panel = view.deriveInsights(value(), 7, t, now);
  const card = panel.cards[0];
  assert.equal(card.title, '近的会话');
  assert.equal(card.billedText, '12.0k');
  assert.equal(card.turnsText, '5');
  assert.equal(card.toolText, '7');
  assert.equal(card.activeText, '2m5s');
  assert.equal(card.pctText, '85.0%');
  assert.equal(card.pctColor, '#FE9A00');
  assert.deepEqual(card.parts.map(part => part.key), ['system', 'tools', 'user']);
  assert.equal(card.contextText, '850 / 1.0k');
  assert.equal(panelHasSearchSort(), true);
  assert.match(wxss, /\.ins-session-bar\s*\{[^}]*height:\s*12rpx/);
  assert.match(wxml, /bindtap="openSession" data-id="\{\{item\.id\}\}"/);
});

function panelHasSearchSort() {
  const panel = view.deriveInsights(value(), 7, t, now);
  return panel.sortOptions.length === 3 && panel.tokenStats.length >= 3 && panel.timingStats.length >= 7
    && panel.coverageOptions.length === 3 && panel.skillSort === 'loads';
}

test('today scope, heatmap selection, search, sorting and pagination filter the session list', () => {
  const source = value();
  source.sessions = Array.from({ length: 15 }, (_, index) => ({
    id: 's' + index,
    title: index === 0 ? 'needle session' : 'session ' + index,
    lastActive: now - (index === 14 ? 40 * DAY : 60 * 60 * 1000),
    billedTokens: index * 100,
    pressureTokens: index * 10,
    contextWindow: 1000,
    composition: { user: index * 10 },
    days: { [dayKey(1)]: { tokens: 100, requests: 1 } }
  }));
  const all = view.deriveInsights(source, 0, t, now);
  assert.equal(all.visibleCount, 15);
  assert.equal(all.pageCount, 2);
  assert.equal(all.cards.length, 12);
  const next = view.deriveInsights(source, 0, t, now, { page: 1, sort: 'tokens' });
  assert.equal(next.cards.length, 3);
  assert.equal(next.cards[0].id, 's2');
  const filtered = view.deriveInsights(source, 0, t, now, { query: 'needle', day: dayKey(1) });
  assert.equal(filtered.visibleCount, 1);
  assert.equal(filtered.cards[0].id, 's0');
  assert.equal(view.deriveInsights(source, 'today', t, now).visibleCount, 14);
});

test('custom calendar scope is inclusive and takes precedence over preset ranges', () => {
  const source = value();
  const custom = view.deriveInsights(source, 7, t, now, {
    customRange: { from: dayKey(2), to: dayKey(1) }
  });
  assert.equal(custom.customRangeActive, true);
  assert.ok(custom.ranges.every(range => !range.active));
  assert.equal(custom.visibleCount, 1);
  assert.equal(custom.cards[0].id, 's1');
  const outside = view.deriveInsights(source, 0, t, now, {
    customRange: { from: dayKey(20), to: dayKey(10) }
  });
  assert.equal(outside.visibleCount, 0);
});

test('workspace grouping and active/archive coverage scope insights without changing the wire rows', () => {
  const source = value();
  source.sessions[0].days = { [dayKey(1)]: { tokens: 100, requests: 1 } };
  source.sessions[1].days = { [dayKey(40)]: { tokens: 200, requests: 1 } };
  const workspaces = [{ title: 'Project A', sessionIds: ['s1'] }];
  const archivedSessionIds = ['s2'];
  const active = view.deriveInsights(source, 0, t, now, { workspaces, archivedSessionIds, coverage: 'active' });
  assert.equal(active.visibleCount, 1);
  assert.equal(active.cards[0].group, 'Project A');
  assert.deepEqual(active.groupOptions.map(item => item.key), ['Project A']);
  const archived = view.deriveInsights(source, 0, t, now, { workspaces, archivedSessionIds, coverage: 'archived' });
  assert.equal(archived.cards[0].id, 's2');
  assert.equal(archived.cards[0].archived, true);
  assert.equal(archived.groupOptions[0].key, '__ungrouped__');
});

test('insights show priced costs and skill catalog details when the host provides them', () => {
  const source = value();
  source.sessions = [{
    ...source.sessions[0], costUsd: 0.02,
    days: { [dayKey(0)]: { tokens: 100, requests: 1, costUsd: 0.02, skills: { review: { loads: 2, last: now - 1000 } } } },
    skillNames: ['review']
  }];
  source.days = [{ day: dayKey(0), tokens: 100 }];
  source.skillCatalog = [{ name: 'review', description: 'Review changes', path: '/skills/review/SKILL.md', source: 'user-dsh' }];
  const panel = view.deriveInsights(source, 'today', t, now, { currency: 'usd' });
  assert.equal(panel.kpi.find(item => item.key === 'cost').valueText, '$0.020');
  assert.equal(panel.weekly[0].costText, '$0.020');
  assert.equal(panel.skillStats[0].info.path, '/skills/review/SKILL.md');
  assert.equal(panel.cards[0].costText, '$0.020');
});

test('gateway estimates day and lifetime cost from the host activity ledger', () => {
  const bridge = require('../scripts/lib/context-bridge.mjs');
  const day = dayKey(0);
  const value = bridge.buildInsightsValue([{
    id: 'priced', title: 'priced', provider: 'deepseek', model: 'deepseek-v4',
    usage: { uncachedInputTokens: 1000000, outputTokens: 0 },
    activity: { days: { [day]: { tokens: 1000000, requests: 1, cost: {
      deepseek: { 'deepseek-v4': { peak: { uncached: 1000000, cacheRead: 0, cacheWrite: 0, output: 0 } } }
    } } } }
  }], now, {
    priceBook: { deepseek: { models: { 'deepseek-v4': { cost: { input: 0.2, output: 1, cache_read: 0.1, cache_write: 0.2 } } } } }
  });
  assert.equal(value.sessions[0].costUsd, 0.4, 'DeepSeek peak pricing doubles the listed amount');
  assert.equal(value.sessions[0].days[day].costUsd, 0.4);
});

test('page is registered as an on-demand subpackage page', () => {
  const pkg = app.subPackages.find(item => item.root === 'pages/insights');
  assert.ok(pkg, 'insights ships in its own subpackage to keep the main bundle small');
  assert.deepEqual(pkg.pages, ['insights']);
  assert.ok(app.preloadRule['pages/session/session'].packages.includes('pages/insights'));
  assert.match(wxml, /ins-kpi/);
  assert.match(wxml, /ins-bar-chart/);
  assert.match(wxml, /ins-ring-row/);
});

// 端到端：宿主 services → 网关 context-insights 帧 → 客户端面板。
// 覆盖线上 0.8.25 的症状（能力已声明但请求被判 unknown message type）。
test('context-insights handler produces the wire value the insights page renders', async () => {
  const bridge = require('../scripts/lib/context-bridge.mjs');
  const now = Date.now();
  const activityDate = new Date(now - 60000);
  const activityDay = activityDate.getFullYear() + '-' + String(activityDate.getMonth() + 1).padStart(2, '0') + '-' + String(activityDate.getDate()).padStart(2, '0');
  const ctx = {
    inject(services, callback) {
      callback({
        sessions: { list: () => [{ id: 'session-a', header: { createdAt: now - 3600000 } }] },
        sessionProjections: {
          snapshot: () => ({
            values: {
              tokenUsage: { uncachedInputTokens: 1000, cacheReadTokens: 9000, outputTokens: 500 },
              sessionStats: { turns: 4, steps: 9, llmMs: 60000, toolMs: 30000 },
              contextPressure: { contextWindow: 200000, pressureTokens: 50000 },
              mobileContext: {
                model: 'deepseek-v4', provider: 'deepseek', counts: { toolCalls: 12 },
                current: { system: 100, tools: 200, user: 50, total: 350 },
                requests: [{ time: now - 60000, total: 300, prompt: 250, output: 50, cacheRead: 200 }]
              },
              contextActivity: { days: { [activityDay]: {
                tokens: 300, requests: 1, turns: 1, toolCalls: 2, toolsMs: 500, wallMs: 2000,
                skills: { review: { n: 2, last: now - 60000 } }
              } } },
              sessionTitle: { title: '测试会话' }
            }
          })
        },
        effect: () => () => {}
      });
    }
  };
  bridge.registerContextServices(ctx);
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false });
  let frame;
  try {
    frame = await bridge.handleContextInsights({ type: 'context-insights', sessionId: 'session-a' });
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(frame.kind, 'context-insights');
  assert.ok(Array.isArray(frame.value.sessions) && frame.value.sessions.length === 1);
  const panel = view.deriveInsights(frame.value, 7, t, now);
  assert.equal(panel.hasData, true);
  assert.equal(panel.empty, false);
  assert.equal(panel.kpi[0].valueText, '1', 'one session counted');
  assert.equal(panel.cards.length, 1);
  assert.equal(panel.cards[0].title, '测试会话');
  assert.equal(panel.cards[0].pctText, '25.0%');
  assert.ok(panel.weekly.length === 7);
  assert.equal(Object.values(frame.value.sessions[0].days).reduce((sum, item) => sum + item.requests, 0), 1);
  assert.equal(Object.values(frame.value.sessions[0].days).reduce((sum, item) => sum + item.inputTokens, 0), 250);
  assert.equal(Object.values(frame.value.sessions[0].days).reduce((sum, item) => sum + item.cacheReadTokens, 0), 200);
  assert.deepEqual(frame.value.sessions[0].skillNames, ['review']);
  assert.equal(panel.skillStats[0].name, 'review');
  assert.equal(panel.skillStats[0].loadText, '2');
  assert.match(panel.kpi.find(item => item.key === 'tokens').subText, /1/, 'scoped daily turns use the activity ledger');
  assert.equal(panel.timingStats.find(item => item.key === 'total').valueText, '2.0s', 'daily wall time uses contextActivity');
  assert.equal(view.deriveInsights(frame.value, 7, t, now, { skill: 'review' }).cards.length, 1);
});
