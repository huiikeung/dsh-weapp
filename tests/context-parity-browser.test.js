// 上下文浏览器 ⇄ dsh-context v0.74.0 契约（spec-browser.md §2）。
//
// 结构：标题行（基线 chips + DNA）、选择器与元信息、10px 组成条、七类手风琴
// （色块/计数/两项 delta/token/占比）、类别内过滤与助手 kind chips、行标签/预览/
// 位置/错误点、展开正文（Raw + 行数 + 复制）、DNA 扁平清单（#位置/类别 chip）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'miniprogram');
const wxss = fs.readFileSync(path.join(root, 'pages/session/session.wxss'), 'utf8');
const wxml = fs.readFileSync(path.join(root, 'pages/session/session.wxml'), 'utf8');
const view = require(path.join(root, 'pages/session/utils/context-view'));

const t = (key, values) => (values
  ? Object.keys(values).reduce((text, name) => text.split('{' + name + '}').join(String(values[name])), key)
  : key);

function value() {
  const requests = [
    { seq: 10, time: 1700000000000, turn: 1, step: 1, system: 100, tools: 200, user: 50, total: 350, items: { system: 1, tools: 5, user: 2 }, prompt: 330, output: 20 },
    { seq: 20, time: 1700000100000, turn: 1, step: 2, system: 120, tools: 180, user: 80, total: 380, items: { system: 1, tools: 4, user: 3 }, prompt: 350, output: 30 },
    { seq: 30, time: 1700000200000, turn: 2, step: 1, system: 120, tools: 180, user: 60, total: 360, items: { system: 1, tools: 4, user: 2 }, prompt: 340, output: 20 }
  ];
  return {
    requests,
    current: { system: 130, tools: 170, user: 70, total: 370 },
    surface: [
      { seq: 5, cat: 'user', tokens: 5, text: '请检查测试' },
      { seq: 15, cat: 'assistant', tokens: 4, text: 'working', kinds: { think: 1, tools: 2, answer: 1 } },
      { seq: 25, cat: 'tool', tokens: 8, tool: 'bash', err: true, text: 'exit 1' },
      { seq: 26, cat: 'user', tokens: 6, text: '继续' }
    ],
    headerEpochs: [{ seq: 2, tools: [{ name: 'read_file', description: 'Read a file' }, { name: 'write_file' }] }]
  };
}

test('head shows the base gran, meta row, 10px composition bar and step picker', () => {
  const browser = view.deriveBrowser(value(), t, { seq: 20 });
  assert.equal(browser.base, 'step');
  assert.equal(browser.baseLabel, '比前步');
  assert.equal(browser.rows.length, 7);
  assert.equal(browser.composition.length, 3);
  const width = browser.composition.reduce((sum, segment) => sum + segment.width, 0);
  assert.ok(Math.abs(width - 100) < 1e-6, 'the composition bar spans the estimated total');
  // 比前步 vs 比前轮（请求 20 的前一轮 = 请求 10，同一基线）。
  const turn = view.deriveBrowser(value(), t, { seq: 20, base: 'turn' });
  assert.equal(turn.base, 'turn');
  assert.equal(turn.baseLabel, '比前轮');
  // CSS: 10px 条（20rpx）、圆角 5px、尾部轨道灰。
  assert.match(wxss, /\.ctx-br-bar\s*\{[^}]*height:\s*20rpx[^}]*border-radius:\s*10rpx/);
  assert.match(wxml, /data-base="step"/);
  assert.match(wxml, /data-base="turn"/);
  assert.match(wxml, /ctx-br-bar-seg/);
});

test('category rows carry swatch, count, both delta badges, token figure and percentage', () => {
  const browser = view.deriveBrowser(value(), t, { seq: 20 });
  const tools = browser.rows.find(row => row.key === 'tools');
  assert.equal(tools.countText, '4 项');
  assert.equal(tools.countDeltaText, '−1');
  assert.equal(tools.countDeltaClass, 'down');
  assert.equal(tools.tokenText, '≈180');
  assert.equal(tools.tokenDeltaText, '−20');
  assert.equal(tools.tokenDeltaClass, 'down');
  assert.equal(tools.pctText, '47.4%');
  assert.equal(tools.disabled, false);
  assert.equal(tools.swatch, 'ctx-c-tools');
  // 空消息类不可展开；system/tools 允许展开看降级说明。
  const empty = view.deriveBrowser({ requests: [{ seq: 1, total: 10, tools: 0 }] }, t, { seq: 1 });
  assert.equal(empty.rows.find(row => row.key === 'user').disabled, true);
  assert.equal(empty.rows.find(row => row.key === 'tools').disabled, false);
  // 插件七类色块与 delta 徽标（15% 底）。
  assert.match(wxss, /\.ctx-br-swatch\s*\{[^}]*width:\s*16rpx[^}]*height:\s*16rpx/);
  assert.match(wxss, /\.ctx-delta-up\s*\{[^}]*rgba\(46,\s*185,\s*92,\s*\.15\)/);
  assert.match(wxss, /\.ctx-delta-down\s*\{[^}]*rgba\(229,\s*72,\s*77,\s*\.15\)/);
  assert.match(wxml, /class="ctx-br-swatch \{\{item\.swatch\}\}"/);
});

test('expanded category rows show tag chips, previews, T/S stamps and failure dots', () => {
  const browser = view.deriveBrowser(value(), t, { seq: null, expanded: ['user', 'tool', 'assistant'], kind: 'think' });
  const user = browser.rows.find(row => row.key === 'user');
  assert.deepEqual(user.nodes.map(node => node.preview), ['继续', '请检查测试'], 'newest message first');
  const tool = browser.rows.find(row => row.key === 'tool');
  assert.equal(tool.nodes[0].chips[0], 'bash');
  assert.equal(tool.nodes[0].error, true);
  assert.equal(tool.nodes[0].stamp, 'T2 S1', 'tool results stamp with the request that consumed them');
  const assistant = browser.rows.find(row => row.key === 'assistant');
  assert.equal(assistant.nodes.length, 1, 'kind filter keeps thinking replies');
  assert.deepEqual(assistant.nodes[0].chips, [], 'no tool calls → no tag chips (empty reply shows a note)');
  assert.equal(assistant.nodes[0].preview, 'working');
  assert.match(wxss, /\.ctx-br-errdot\s*\{[^}]*background:\s*#E5484D/);
  assert.match(wxml, /wx:if="\{\{node\.error\}\}"/);
});

test('assistant kind chips and per-category search drive the visible rows', () => {
  const browser = view.deriveBrowser(value(), t, { seq: 30, expanded: ['assistant'], query: 'working' });
  assert.deepEqual(browser.kindChips.map(chip => chip.key), ['think', 'tools', 'answer']);
  assert.equal(browser.rows.find(row => row.key === 'assistant').nodes.length, 1);
  const search = view.deriveBrowser(value(), t, { seq: 30, expanded: ['assistant'], query: '不存在' });
  assert.equal(search.rows.find(row => row.key === 'assistant').nodes.length, 0);
  assert.match(wxss, /\.ctx-br-search\s*\{[^}]*height:\s*56rpx/);
  assert.match(wxml, /bindinput="setContextBrowserQuery"/);
  assert.match(wxml, /bindtap="setContextBrowserKind"/);
});

test('DNA flat list numbers entries in model reading order with category chips and stamps', () => {
  const browser = view.deriveBrowser(value(), t, { seq: 30, dna: true });
  assert.equal(browser.dna, true);
  assert.deepEqual(browser.dnaRows.map(row => row.posText), browser.dnaRows.map((row, index) => '#' + (index + 1)));
  assert.ok(browser.dnaRows.every(row => row.categoryText && row.tokenText && row.stamp !== undefined));
  assert.match(wxss, /\.ctx-br-cat-chip\.ctx-c-assistant\s*\{[^}]*rgba\(43,\s*127,\s*255,\s*\.14\)/);
  assert.match(wxss, /\.ctx-br-scroll\s*\{[^}]*max-height:\s*62vh/);
  assert.match(wxml, /ctx-br-flat-row/);
  assert.match(wxml, /class="ctx-br-pos"/);
});

test('tool definition rows expose source chip, description and parameter table inline', () => {
  const value = {
    requests: [{ seq: 10, time: 1000, turn: 1, system: 10, tools: 20, total: 30, items: { system: 1, tools: 2 } }],
    surface: [],
    headerEpochs: [{
      seq: 2, time: 900,
      tools: [{ name: 'read_file' }, { name: 'bash' }],
      meta: [
        { name: 'read_file', description: 'Read a file', source: '@deepseek-ai/dsh-tool-fs', tokens: 40,
          params: [{ name: 'file_path', type: 'string', required: true, description: 'Path to read' }] },
        { name: 'bash', tokens: 30 }
      ]
    }]
  };
  const browser = view.deriveBrowser(value, t, { seq: 10, expanded: ['tools'], toolName: 'read_file' });
  const tools = browser.rows.find(row => row.key === 'tools');
  const readRow = tools.nodes.find(node => node.chips[0] === 'read_file');
  assert.equal(readRow.source, '@deepseek-ai/dsh-tool-fs');
  assert.equal(readRow.description, 'Read a file');
  assert.equal(readRow.expanded, true);
  assert.deepEqual(readRow.params, [{ name: 'file_path', type: 'string', required: true, description: 'Path to read' }]);
  const bashRow = tools.nodes.find(node => node.chips[0] === 'bash');
  assert.equal(bashRow.metaOnly, false, 'epoch metadata exists; the row just has no schema');
  assert.deepEqual(bashRow.params, []);
  assert.equal(bashRow.expanded, false);
  // 旧网关/旧纪元没有 meta：整行降级为「仅 token 估算」。
  const legacy = view.deriveBrowser({
    requests: value.requests, surface: [],
    headerEpochs: [{ seq: 2, time: 900, tools: [{ name: 'read_file' }] }]
  }, t, { seq: 10, expanded: ['tools'] });
  assert.equal(legacy.rows.find(row => row.key === 'tools').nodes[0].metaOnly, true);
  // 插件参数表：140/90/56/1fr 四列，必填 ✓ 用 warn 色。
  assert.match(wxss, /\.ctx-br-param\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*140rpx\) minmax\(0,\s*90rpx\) 56rpx minmax\(0,\s*1fr\)/);
  assert.match(wxss, /\.ctx-br-param-req\s*\{[^}]*color:\s*var\(--amber\)/);
  assert.match(wxml, /catchtap="contextBrowserNodeTap"/);
  assert.match(wxml, /class="ctx-br-params"/);
});

test('content panel exposes line count and a copy action instead of hover tooltips', () => {
  const session = fs.readFileSync(path.join(root, 'pages/session/session.js'), 'utf8');
  assert.match(session, /lineText: uiText\('\{n\} 行'/);
  assert.match(session, /copyContextNodeText\(\)[\s\S]*?wx\.setClipboardData/);
  assert.match(wxml, /catchtap="copyContextNodeText"/);
  assert.match(wxss, /\.ctx-br-content\s*\{[^}]*white-space:\s*pre-wrap/);
});
