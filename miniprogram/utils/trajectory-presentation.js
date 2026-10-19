const markdown = require('./markdown');
const { t } = require('./ui-preferences');
const COPY = { Started:'开始时间', 'Total duration':'总时长', TTFT:'首 token 延迟', Generation:'生成', Throughput:'吞吐量', 'Request Timing':'请求计时', Options:'选项', 'This request':'本次请求', 'Session cumulative':'会话累计', Status:'状态', Provider:'提供方', Model:'模型', 'Tool calls':'工具调用', 'Subtool calls':'子工具调用', Result:'结果', 'Assistant Message':'助手消息', Payload:'参数', Hierarchy:'层级', Duration:'时长', 'Timing source':'计时来源', 'Session timestamps':'会话时间戳', Timing:'计时', Thinking:'思考', Content:'内容', Preview:'预览', Attachments:'附件', Source:'来源', Tokens:'Token', Reasoning:'推理', Failed:'失败', Interrupted:'已中断', Completed:'已完成', Incomplete:'未完成', Running:'正在运行', Tool:'工具', User:'用户', Assistant:'助手', Context:'上下文', '摘要':'概述', '耗时':'计时', '原始':'原始内容' };
const copy = text => t(COPY[text] || text);
const BADGE_LABELS = { USER: '用户', ASSISTANT: '助手', TOOL: '工具', SUBTOOL: '子工具', CONTEXT: '上下文', REQUEST: '请求', EVENT: '事件' };
const json = v => v == null ? '' : JSON.stringify(v, null, 2);
const display = v => typeof v === 'string' ? v : json(v);
const clip = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 160);
const seconds = v => v == null ? '—' : t('{value} 秒', { value: (v / 1000).toFixed(2) });
function timestamp(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e10 ? v : v * 1000;
  if (typeof v === 'string') { const n = Date.parse(v); return Number.isFinite(n) ? n : null; }
  return null;
}
function token(v, keys) {
  if (!v || typeof v !== 'object') return null;
  for (const key of keys) if (typeof v[key] === 'number' && Number.isFinite(v[key])) return Math.max(0, v[key]);
  for (const child of Object.values(v)) { const n = token(child, keys); if (n !== null) return n; }
  return null;
}
function usage(v) {
  return { input: token(v, ['inputTokens', 'input_tokens', 'uncachedInputTokens', 'promptTokens']),
    cached: token(v, ['cacheReadTokens', 'cachedInputTokens', 'cached_tokens']),
    output: token(v, ['outputTokens', 'output_tokens', 'completionTokens']),
    reasoning: token(v, ['reasoningTokens', 'reasoning_tokens']) };
}
function build(source, sessionId, normalize) {
  const events = source.slice().sort((a, b) => a.seq - b.seq);
  const rows = [], calls = new Map(), assistants = new Map();
  const metadata = events.filter(r => ['request/header', 'request/context'].includes(r.type));
  const hr = metadata.find(r => r.type === 'request/header'), cr = metadata.find(r => r.type === 'request/context');
  const header = hr && hr.data && hr.data.header || {}, context = cr && cr.data || {};
  const definitions = Array.isArray(header.tools) ? header.tools : [];
  let turn = null, step = null, next = null, requestNumber = 0;
  const following = [];
  for (let i = events.length - 1; i >= 0; i--) { const d = events[i].data || {}; if (d.turn != null) next = d.turn; following[i] = next; }
  function create(raw, badge, label) {
    const time = timestamp(raw.time);
    const row = { kind: 'event', key: 'ev-' + raw.seq + '-' + badge.toLowerCase(), badge, displayBadge: BADGE_LABELS[badge] || badge,
      badgeClass: badge.toLowerCase(), label, preview: '', seq: raw.seq, time, turn, step, eventType: raw.type,
      inputText: '', outputText: '', thinkingText: '', startedAt: time, endedAt: time, firstTokenAt: null,
      durationMs: null, completed: false, isError: false, sourceRecords: [] };
    rows.push(row); return row;
  }
  function record(row, raw) {
    // Events are sequence-sorted. Avoid rescanning every earlier streaming chunk.
    const last = row.sourceRecords[row.sourceRecords.length - 1];
    if (!last || last.seq !== raw.seq) row.sourceRecords.push(raw);
    row.endedAt = timestamp(raw.time);
  }
  function assistant(raw) {
    const key = String(turn) + ':' + String(step);
    let row = assistants.get(key);
    if (!row || row.finalized) {
      row = create(raw, 'ASSISTANT', 'Assistant');
      row.requestKey = 'request-' + raw.seq; row.requestNumber = ++requestNumber;
      assistants.set(key, row);
    }
    record(row, raw); return row;
  }
  function tool(raw, event, subtool) {
    const d = raw.data || {}, id = subtool ? d.subCallId : event.callId || d.callId;
    const key = (subtool ? 'sub:' : 'tool:') + String(turn) + ':' + String(id || raw.seq);
    let row = calls.get(key);
    const isCall = /(?:call|dispatch-start)$/.test(raw.type);
    if (!row) {
      row = create(raw, subtool ? 'SUBTOOL' : 'TOOL', event.name || (subtool ? 'subtool' : 'tool'));
      row.callId = id || null; row.parentCallId = d.parentCallId || null; row.rootCallId = d.rootCallId || null;
      row.hierarchy = subtool ? 'Tool' : 'Assistant Message';
      if (!isCall) row.startedAt = null;
      calls.set(key, row);
    }
    record(row, raw);
    if (event.name) row.label = event.name;
    if (event.arguments !== undefined) row.inputText = display(event.arguments);
    if (isCall) { row.startedAt = timestamp(raw.time); row.schema = definitions.find(t => t.name === event.name) || null; }
    else { row.completed = true; row.outputText = event.preview || display(d.result) || ''; row.isError = event.isError === true; }
    row.preview = clip(row.inputText) + (row.outputText ? ' → ' + clip(row.outputText) : '');
  }
  events.forEach((raw, index) => {
    const event = normalize(raw, sessionId).event, d = raw.data || {};
    if (d.turn != null) { if (turn !== d.turn) step = null; turn = d.turn; }
    if (raw.type === 'user/message' && (event.source == null || event.source === 'user')) { turn = d.turn == null ? following[index] : d.turn; step = null; }
    if (d.step != null) step = d.step;
    if (raw.type === 'turn/start') { step = null; return; }
    if (raw.type === 'step/start') return;
    if (raw.type === 'turn/end') {
      rows.filter(r => r.turn === turn && !r.completed).forEach(r => { r.stopped = true; r.isError = r.isError || event.reason === 'error'; r.interrupted = /aborted|interrupted/.test(event.reason || ''); });
      return;
    }
    if (raw.type === 'assistant/chunk') {
      const row = assistant(raw);
      if (['text', 'text-delta', 'reasoning', 'reasoning-delta'].includes(event.chunkType) && event.text) {
        if (row.firstTokenAt == null) row.firstTokenAt = timestamp(raw.time);
        if (event.chunkType.indexOf('reasoning') === 0) row.thinkingText += event.text; else row.outputText += event.text;
      }
      if (event.usage) row.usage = event.usage;
      row.preview = clip(row.thinkingText || row.outputText) || t('（仅工具调用）'); return;
    }
    if (raw.type === 'assistant/message' || raw.type === 'assistant/attempt') {
      const row = assistant(raw);
      row.outputText = event.text || row.outputText; row.thinkingText = event.reasoning || row.thinkingText;
      row.toolCalls = event.toolCalls || []; row.completed = raw.type === 'assistant/message';
      row.finalized = true;
      row.interrupted = event.interrupted === true; row.isError = event.isError === true || !!d.error;
      row.usage = d.usage || (d.message && d.message.usage) || row.usage;
      row.modelSource = d.message && d.message.source || {};
      row.preview = clip(row.thinkingText || row.outputText) || t('（仅工具调用）'); return;
    }
    if (['tool/call', 'tool/result'].includes(raw.type)) { tool(raw, event, false); return; }
    if (['tool/code-dispatch-start', 'tool/code-dispatch'].includes(raw.type)) { tool(raw, event, true); return; }
    if (raw.type === 'user/message') {
      const user = event.source == null || event.source === 'user';
      if (!event.text && !(event.images || []).length) return;
      const row = create(raw, user ? 'USER' : 'CONTEXT', user ? 'User' : event.source || 'Context');
      record(row, raw); row.inputText = event.text || ''; row.images = event.images || []; row.completed = true;
      row.preview = clip(row.inputText) || t('图片附件');
    }
  });
  const cumulative = { input: null, cached: null, output: null, reasoning: null };
  for (const row of rows) {
    if (row.badge === 'SUBTOOL') {
      const parent = rows.find(r => r.badge === 'TOOL' && r.turn === row.turn && r.callId === (row.parentCallId || row.rootCallId));
      if (parent) row.hierarchy = parent.label;
    }
    if (row.startedAt != null && row.endedAt != null) row.durationMs = Math.max(0, row.endedAt - row.startedAt);
    row.durationLabel = seconds(row.durationMs); row.seqLabel = String(row.seq); row.stepLabel = row.step == null ? '' : t('第 {step} 步', { step: row.step });
    row.statusLabel = row.isError ? 'Failed' : row.interrupted ? 'Interrupted' : row.completed ? 'Completed' : row.stopped ? 'Incomplete' : 'Running';
    // Keep original records in logic memory; stringify only when raw detail is opened.
    if (row.badge === 'ASSISTANT') {
      const tokens = usage(row.usage);
      Object.keys(cumulative).forEach(key => { if (tokens[key] != null) cumulative[key] = (cumulative[key] || 0) + tokens[key]; });
      const options = header.config || null, model = row.modelSource || {}, callIds = (row.toolCalls || []).map(c => c.id);
      row.request = { ...row, key: row.requestKey, badge: 'REQUEST', displayBadge: BADGE_LABELS.REQUEST, label: t('请求 #{request}', { request: row.requestNumber }),
        request: null, options, provider: model.provider || context.provider || (options && options.provider) || '—',
        model: model.model || context.model || (options && options.model) || '—', tokens, cumulative: { ...cumulative },
        toolCount: callIds.length || rows.filter(r => r.badge === 'TOOL' && r.turn === row.turn && r.step === row.step).length,
        subtoolCount: rows.filter(r => r.badge === 'SUBTOOL' && r.turn === row.turn && (callIds.includes(r.parentCallId) || callIds.includes(r.rootCallId) || r.step === row.step)).length,
        sourceRecords: metadata.concat(row.sourceRecords) };
    }
  }
  let current = null; const result = [];
  rows.forEach((row, index) => {
    if (row.turn != null && row.turn !== current) { current = row.turn; result.push({ kind: 'turn', key: 'turn-' + current + '-' + row.seq, turn: current, label: t('第 {turn} 轮', { turn: current }) }); }
    row.index = index + 1; result.push(row);
  });
  return result;
}
function overview(rows) {
  const events = rows.filter(r => r.kind === 'event');
  const duration = events.reduce((sum, r) => sum + Math.max(0, r.durationMs || 0), 0);
  const minimum = Math.max(1, duration / 500), total = events.reduce((sum, r) => sum + Math.max(minimum, r.durationMs || 0), 0) || 1;
  const lanes = [{ id: 'input', label: t('输入'), segments: [] }, { id: 'model', label: t('模型'), segments: [] }, { id: 'tools', label: t('工具'), segments: [] }];
  let cursor = 0;
  events.forEach(row => {
    const weight = Math.max(minimum, row.durationMs || 0), lane = row.badge === 'USER' ? lanes[0] : ['TOOL', 'SUBTOOL'].includes(row.badge) ? lanes[2] : lanes[1];
    lane.segments.push({ key: row.key, badgeClass: row.badgeClass, style: 'left:' + (cursor / total * 100).toFixed(3) + '%;width:' + (weight / total * 100).toFixed(3) + '%;' });
    cursor += weight;
  });
  return { durationLabel: seconds(duration), turns: new Set(events.filter(r => r.turn != null).map(r => r.turn)).size, calls: events.filter(r => ['TOOL', 'SUBTOOL'].includes(r.badge)).length, lanes };
}
function sections(row, selectedId) {
  const tabs = [], field = (label, value) => ({ label: copy(label), value: value == null ? '—' : String(value) });
  const richPreview = !selectedId || selectedId === 'summary' || selectedId === 'preview';
  const block = (title, text, code, collapsible) => ({ title: copy(title), text: text || '', code: !!code, collapsible: !!collapsible, blocks: code || !richPreview ? [] : markdown.parse(text || '') });
  function add(id, label, fields, blocks) {
    if (selectedId && selectedId !== id) return;
    tabs.push({ id, label: copy(label), fields: fields || [], blocks: blocks || [], text: (fields || []).map(f => f.label + ': ' + f.value).concat((blocks || []).map(b => b.title + '\n' + b.text)).join('\n\n') });
  }
  const date = row.startedAt == null ? null : new Date(row.startedAt), pad = (n, len) => String(n).padStart(len || 2, '0');
  const started = !date ? '—' : date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) + '.' + pad(date.getMilliseconds(), 3);
  const timing = [field('Started', started), field('Total duration', row.durationLabel)];
  if (row.firstTokenAt != null && row.startedAt != null) timing.push(field('TTFT', seconds(Math.max(0, row.firstTokenAt - row.startedAt))));
  const generation = row.firstTokenAt != null && row.endedAt != null ? Math.max(0, row.endedAt - row.firstTokenAt) : null, tokens = row.tokens || usage(row.usage);
  if (generation != null) timing.push(field('Generation', seconds(generation)));
  if (generation > 0 && tokens.output != null) timing.push(field('Throughput', (tokens.output / (generation / 1000)).toFixed(1) + ' tok/s'));
  const timingBlock = block('Request Timing', timing.map(f => f.label + ': ' + f.value).join('\n'), true);
  if (row.badge === 'REQUEST') {
    const options = block('Options', display(row.options) || t('没有记录模型选项'), true);
    const tokenLines = counts => {
      const tok = n => n == null ? '—' : n + ' tok';
      return [t('输入') + ': ' + tok(counts.input == null && counts.cached == null ? null : (counts.input || 0) + (counts.cached || 0)), '  ' + t('缓存读取') + ': ' + tok(counts.cached), '  ' + t('其他') + ': ' + tok(counts.input),
        t('输出') + ': ' + tok(counts.output), '  ' + t('推理') + ': ' + tok(counts.reasoning), '  ' + t('内容') + ': ' + tok(counts.output == null ? null : Math.max(0, counts.output - (counts.reasoning || 0)))].join('\n');
    };
    const tokenBlocks = [block('This request', tokenLines(tokens), true), block('Session cumulative', tokenLines(row.cumulative || tokens), true)];
    add('summary', '摘要', [field('Status', copy(row.statusLabel)), field('Provider', row.provider), field('Model', row.model), field('Tool calls', row.toolCount), field('Subtool calls', row.subtoolCount), field('Result', row.completed ? copy('Assistant Message') : '—')], [options, ...tokenBlocks, timingBlock]);
    add('options', '选项', [], [options]); add('usage', '用量', [], tokenBlocks); add('timing', '耗时', timing);
  } else if (['TOOL', 'SUBTOOL'].includes(row.badge)) {
    const payload = block('Payload', row.inputText || t('没有参数'), true), result = block('Result', row.outputText || (row.completed ? t('无输出') : row.stopped ? t('未记录工具结果') : t('等待工具返回…')), true);
    const schema = block('Schema', display(row.schema) || t('没有记录工具 Schema'), true);
    const toolTiming = [field('Started', started), field('Duration', row.durationLabel), field('Timing source', copy('Session timestamps'))];
    add('summary', '摘要', [field('Hierarchy', row.badge === 'TOOL' || row.hierarchy === 'Tool' ? copy(row.hierarchy) : row.hierarchy), field('Status', copy(row.statusLabel))], [payload, result, ...(row.badge === 'TOOL' ? [schema] : []), block('Timing', toolTiming.map(f => f.label + ': ' + f.value).join('\n'), true)]);
    add('input', '参数', [], [payload]); add('output', '结果', [], [result]);
    if (row.badge === 'TOOL') add('schema', 'Schema', [], [schema]);
    add('timing', '耗时', toolTiming);
  } else {
    const preview = [];
    if (row.thinkingText) preview.push(block('Thinking', row.thinkingText, false, true));
    if (row.outputText || row.inputText) preview.push(block(row.badge === 'ASSISTANT' ? 'Content' : 'Preview', row.outputText || row.inputText, false));
    if (row.images && row.images.length) preview.push(block('Attachments', row.images.map(i => i.name || i.attachmentId || t('图片附件')).join('\n'), true));
    if (!preview.length) preview.push(block('Preview', row.preview || t('没有记录正文'), false));
    const fields = [field('Source', row.requestNumber ? t('请求 #{request}', { request: row.requestNumber }) : row.turn != null ? t('请求 #{request}', { request: row.turn }) : '#' + row.seq), field('Status', copy(row.statusLabel))];
    if (tokens.output != null) fields.push(field('Tokens', tokens.output + ' tok'), field('Reasoning', tokens.reasoning == null ? '—' : tokens.reasoning + ' tok'), field('Content', Math.max(0, tokens.output - (tokens.reasoning || 0)) + ' tok'));
    add('summary', '摘要', fields, [...preview, timingBlock]); add('preview', '预览', [], preview.map(b => ({ ...b, collapsible: false })));
    const raw = [];
    if (row.thinkingText) raw.push(block(t('思考'), row.thinkingText, true));
    if (row.outputText || row.inputText) raw.push(block(t('文本'), row.outputText || row.inputText, true));
    (row.toolCalls || []).forEach(c => raw.push(block(t('工具调用') + ' ' + c.name, display(c.arguments), true)));
    if (!raw.length && (!selectedId || selectedId === 'raw')) raw.push(block(t('内容'), row.detail || json(row.sourceRecords) || '', true));
    add('raw', '原始', [], raw.map((b, i) => ({ ...b, title: t('块 #{index} {type}', { index: i + 1, type: b.title }) })));
  }
  return tabs;
}
function tabs(row) {
  const entries = row.badge === 'REQUEST'
    ? [['summary', '摘要'], ['options', '选项'], ['usage', '用量'], ['timing', '耗时']]
    : ['TOOL', 'SUBTOOL'].includes(row.badge)
      ? [['summary', '摘要'], ['input', '参数'], ['output', '结果'], ...(row.badge === 'TOOL' ? [['schema', 'Schema']] : []), ['timing', '耗时']]
      : [['summary', '摘要'], ['preview', '预览'], ['raw', '原始']];
  return entries.map(([id, label]) => ({ id, label: copy(label) }));
}
function listRow(row) {
  const item = localize(row);
  const out = {};
  for (const key of ['kind', 'key', 'turn', 'label', 'badge', 'displayBadge', 'badgeClass', 'preview', 'seqLabel', 'requestNumber', 'durationMs']) {
    if (item[key] !== undefined) out[key] = item[key];
  }
  out.badgeClass = String(item.badge || '').toLowerCase();
  out.seqLabel = typeof item.seq === 'number' ? String(item.seq).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
  if (item.request) out.request = { key: item.request.key };
  return out;
}
function filter(rows, query, kind) {
  const q = String(query || '').trim().toLowerCase(), out = []; let heading = null;
  for (const row of rows) {
    if (row.kind === 'turn') { heading = row; continue; }
    if (kind && kind !== 'all' && row.badge !== kind) continue;
    if (q && ![row.label, row.preview, row.inputText, row.outputText, row.thinkingText, row.eventType, String(row.seq)].join('\n').toLowerCase().includes(q)) continue;
    if (heading) { out.push(heading); heading = null; } out.push(row);
  }
  return out;
}
function localize(row) {
  if (row.kind === 'turn') return { ...row, label: t('第 {turn} 轮', { turn: row.turn == null ? (row.label.match(/\d+/) || [''])[0] : row.turn }) };
  const value = { ...row, displayBadge: t(BADGE_LABELS[row.badge] || row.badge), durationLabel: seconds(row.durationMs), stepLabel: row.step == null ? '' : t('第 {step} 步', { step: row.step }) };
  if (row.badge === 'USER') value.label = t('用户');
  if (row.badge === 'ASSISTANT') value.label = t('助手');
  if (row.badge === 'CONTEXT' && ['Context','上下文'].includes(row.label)) value.label = t('上下文');
  if (row.badge === 'REQUEST') value.label = t('请求 #{request}', { request: row.requestNumber });
  if (row.badge === 'ASSISTANT' && !row.outputText && !row.thinkingText) value.preview = t('（仅工具调用）');
  if (row.request) value.request = localize(row.request);
  return value;
}
module.exports = { build, sections, tabs, listRow, filter, timestamp, overview, localize };
