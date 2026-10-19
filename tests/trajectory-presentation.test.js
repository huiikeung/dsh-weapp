const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const view = require('../miniprogram/utils/trajectory-presentation');
const protocol = require('../miniprogram/utils/protocol');
const event = (seq, type, data = {}, time = 1800000000 + seq) => ({ seq, type, data, time });
const project = events => protocol.buildTrajectory(events, 's1');
const fixture = () => [
  event(1, 'request/header', { header: { config: { provider: 'deepseek', model: 'test-model', temperature: 0.5 }, tools: [{ name: 'read', description: 'Read a file', parameters: { type: 'object' } }] } }),
  event(2, 'user/message', { content: 'Read **README**' }),
  event(3, 'turn/start', { turn: 1 }), event(4, 'step/start', { turn: 1, step: 1 }),
  event(5, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'Inspect first' } }),
  event(6, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'Reading' } }),
  event(7, 'assistant/message', { turn: 1, step: 1, usage: { inputTokens: 20, cacheReadTokens: 10, outputTokens: 8, reasoningTokens: 3 }, message: { content: [{ type: 'reasoning', text: 'Inspect first' }, { type: 'text', text: 'Reading **README**' }, { type: 'tool-call', id: 'c1', name: 'read', arguments: { path: 'README' } }] } }),
  event(8, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: { path: 'README' } }),
  event(9, 'tool/code-dispatch-start', { turn: 1, step: 1, subCallId: 'sub1', parentCallId: 'c1', name: 'stat', arguments: { path: 'README' } }),
  event(10, 'tool/code-dispatch', { turn: 1, step: 1, subCallId: 'sub1', parentCallId: 'c1', name: 'stat', content: [{ type: 'text', text: 'exists' }] }),
  event(11, 'tool/result', { turn: 1, step: 1, message: { source: { callId: 'c1' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: 'File contents' }] }] } }),
  event(12, 'turn/end', { turn: 1, reason: 'completed' })
];
test('DSH projection shows only semantic nodes with Turn headings and paired tool results', () => {
  const rows = project(fixture()), nodes = rows.filter(r => r.kind === 'event');
  assert.equal(rows[0].label, '第 1 轮');
  assert.deepEqual(nodes.map(r => r.badge), ['USER', 'ASSISTANT', 'TOOL', 'SUBTOOL']);
  const tool = nodes[2], sub = nodes[3];
  assert.equal(tool.outputText, 'File contents'); assert.equal(tool.durationMs, 3000);
  assert.equal(tool.schema.name, 'read'); assert.equal(sub.hierarchy, 'read');
  assert.equal(sub.outputText, 'exists'); assert.equal(sub.durationMs, 1000);
  assert.deepEqual(view.sections(tool).map(t => t.label), ['概述', '参数', '结果', 'Schema', '计时']);
  assert.deepEqual(view.sections(sub).map(t => t.label), ['概述', '参数', '结果', '计时']);
  assert.ok(view.sections(tool)[0].text.includes('File contents'));
});
test('message sheets contain rich preview, collapsed thinking and content blocks, not event envelopes', () => {
  const model = project(fixture()).find(r => r.badge === 'ASSISTANT'), tabs = view.sections(model);
  assert.deepEqual(tabs.map(t => t.label), ['概述', '预览', '原始内容']);
  assert.equal(tabs[0].blocks[0].collapsible, true);
  assert.equal(tabs[1].blocks[0].collapsible, false);
  assert.ok(tabs[1].blocks.find(b => b.title === '内容').blocks[0].html.includes('<strong>README</strong>'));
  assert.deepEqual(tabs[2].blocks.map(b => b.title), ['块 #1 思考', '块 #2 文本', '块 #3 工具调用 read']);
  assert.ok(!tabs[2].text.includes('assistant/chunk'));
});
test('request dots expose config, usage, cumulative tokens, TTFT and throughput', () => {
  const row = project(fixture()).find(r => r.badge === 'ASSISTANT'), request = row.request;
  assert.equal(request.model, 'test-model'); assert.equal(request.toolCount, 1); assert.equal(request.subtoolCount, 1);
  const tabs = view.sections(request);
  assert.deepEqual(tabs.map(t => t.label), ['概述', '选项', '用量', '计时']);
  assert.ok(tabs[2].text.includes('输入: 30 tok')); assert.ok(tabs[2].text.includes('内容: 5 tok'));
  assert.equal(tabs[3].fields.find(f => f.label === '首 token 延迟').value, '0.00 秒');
  assert.equal(tabs[3].fields.find(f => f.label === '吞吐量').value, '4.0 tok/s');
  const more = fixture().concat(event(13, 'assistant/message', { turn: 2, step: 1, usage: { outputTokens: 2 }, message: { content: 'Done' } }));
  assert.equal(project(more).filter(r => r.badge === 'ASSISTANT')[1].request.cumulative.output, 10);
});
test('streaming nodes retain keys and final content replaces deltas without duplication', () => {
  const initial = project(fixture().slice(0, 6)).find(r => r.badge === 'ASSISTANT');
  const final = project(fixture()).find(r => r.badge === 'ASSISTANT');
  assert.equal(initial.key, final.key); assert.equal(initial.request.key, final.request.key);
  assert.equal(initial.statusLabel, 'Running'); assert.equal(final.statusLabel, 'Completed');
  assert.equal(final.thinkingText, 'Inspect first');
  assert.equal(final.outputText, 'Reading **README**');
});
test('overview packs active duration, excludes idle gaps and includes subtools', () => {
  const rows = project(fixture()), overview = view.overview(rows);
  assert.equal(overview.turns, 1); assert.equal(overview.calls, 2); assert.equal(overview.durationLabel, '6.00 秒');
  assert.deepEqual(overview.lanes.map(l => l.segments.length), [1, 1, 2]);
  const shifted = fixture().map(r => ({ ...r, time: r.time + (r.seq >= 8 ? 5000 : 0) }));
  assert.deepEqual(view.overview(project(shifted)), overview);
  assert.equal(view.overview([]).durationLabel, '0.00 秒');
});
test('missing timestamps, result-only history and interrupted tools remain honest', () => {
  const rows = project([event(1, 'tool/result', { callId: 'old', result: 'replayed', error: 'failed' }, null),
    event(2, 'tool/call', { callId: 'pending', name: 'read' }), event(3, 'turn/end', { reason: 'interrupted' })]);
  assert.equal(rows[0].outputText, 'replayed'); assert.equal(rows[0].statusLabel, 'Failed'); assert.equal(rows[0].durationLabel, '—');
  assert.equal(rows[1].statusLabel, 'Interrupted'); assert.ok(view.sections(rows[1])[2].text.includes('未记录'));
  const model = project([event(1, 'assistant/message', { message: { content: 'x' } })])[0];
  assert.ok(view.sections(model.request)[2].text.includes('输出: —'));
});
test('tool ids reused in later turns are not combined and image-only input survives', () => {
  const rows = project([event(1, 'tool/call', { turn: 1, callId: 'same', name: 'read' }), event(2, 'tool/call', { turn: 2, callId: 'same', name: 'write' }),
    event(3, 'user/message', { content: [{ type: 'image', attachment: { attachmentId: 'img', name: 'photo' } }] })]);
  assert.equal(rows.filter(r => r.badge === 'TOOL').length, 2);
  assert.ok(view.sections(rows.find(r => r.badge === 'USER'))[0].text.includes('photo'));
});
test('retries in the same step remain separate requests instead of overwriting the failed attempt', () => {
  const rows = project([event(1, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'First try' } }),
    event(2, 'assistant/attempt', { turn: 1, step: 1, error: 'retry' }),
    event(3, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'Retry' } }),
    event(4, 'assistant/message', { turn: 1, step: 1, message: { content: 'Success' } })]).filter(r => r.badge === 'ASSISTANT');
  assert.equal(rows.length, 2); assert.equal(rows[0].statusLabel, 'Failed'); assert.equal(rows[1].statusLabel, 'Completed');
  assert.notEqual(rows[0].request.key, rows[1].request.key); assert.equal(rows[1].requestNumber, 2);
  assert.equal(rows[1].thinkingText, '');
});
test('detail selection refreshes request/tool content and closes on session switch', () => {
  const filename = path.resolve(__dirname, '../miniprogram/pages/session/session.js'); let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { Page: d => { definition = d; }, require: name => require(path.resolve(path.dirname(filename), name)), console });
  const page = { ...definition, data: { ...definition.data, trajectory: project(fixture().slice(0, 9)) }, _renderSessionId: 's1', setData(patch) { Object.assign(this.data, patch); } };
  const model = page.data.trajectory.find(r => r.badge === 'ASSISTANT');
  page.openTraceRequest({ currentTarget: { dataset: { key: model.key } } });
  assert.equal(page.data.traceDetail.badge, 'REQUEST');
  page.selectTraceDetailTab({ currentTarget: { dataset: { id: 'usage' } } });
  Object.assign(page.data, page.traceSelectionPatch(project(fixture())));
  assert.equal(page.data.traceDetailTab, 'usage');
  const tool = page.data.trajectory.find(r => r.badge === 'TOOL');
  page.openTraceDetail({ currentTarget: { dataset: { key: tool.key } } });
  Object.assign(page.data, page.traceSelectionPatch(project(fixture())));
  assert.ok(page.data.traceDetailSection.text.includes('File contents'));
  assert.equal(page.data.traceDetail.sourceRecords, undefined, 'raw records stay off the view bridge');
  page._renderSessionId = 'other'; assert.equal(page.traceSelectionPatch(project(fixture())).traceDetail, null);
});
test('trajectory list keeps summaries but never sends full messages or source events', () => {
  const rows = project(fixture().concat(event(13, 'assistant/message', { message: { content: 'large body '.repeat(10000) } })));
  const list = rows.map(view.listRow);
  assert.ok(Buffer.byteLength(JSON.stringify(list)) < 6000);
  for (const row of list) for (const key of ['sourceRecords', 'outputText', 'thinkingText', 'schema', 'detail', 'options']) assert.equal(row[key], undefined);
  assert.ok(list.find(row => row.badge === 'ASSISTANT').request.key);
  assert.deepEqual(view.overview(list), view.overview(rows));
});
test('lazy detail sections match full sections and tab metadata', () => {
  for (const row of project(fixture()).filter(row => row.kind === 'event').flatMap(row => row.request ? [row, row.request] : [row])) {
    const all = view.sections(row);
    assert.deepEqual(view.tabs(row), all.map(({ id, label }) => ({ id, label })));
    for (const section of all) assert.deepEqual(view.sections(row, section.id), [section]);
  }
});
