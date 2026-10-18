// Gateway 事件归一化与对话/轨迹投影。
// 与 shared/protocol + projection 的语义对齐：user/message、assistant/chunk、
// assistant/message、tool/call、tool/result 等事件的字段提取规则一致。

const { jsonDisplayText, oneLine, eventDateMs } = require('./util');

// ---------- 事件归一化 ----------

/** 块数组安全提取：兼容 块数组 / {content:块数组} / {content:"字符串"} / 纯字符串 */
function asBlocks(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.content)) return value.content;
  return [];
}

function textBlocks(value) {
  // content 可能是纯字符串（用户消息回显常见形态）、块数组、或 {content: 块数组}
  if (typeof value === 'string') return value;
  if (value && typeof value.content === 'string') return value.content;
  const blocks = asBlocks(value);
  return blocks
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text || '')
    .join('');
}

function imageBlocks(value) {
  if (typeof value === 'string') return [];
  const blocks = asBlocks(value);
  return blocks
    .filter((b) => b && b.type === 'image' && b.attachment)
    .map((b) => ({
      attachmentId: b.attachment.attachmentId,
      mediaType: b.attachment.mediaType,
      bytes: b.attachment.bytes,
      width: b.attachment.width,
      height: b.attachment.height,
      name: b.attachment.name || null
    }));
}

function toolResultText(message) {
  const outer = (message && message.content) || [];
  const parts = [];
  outer.forEach((item) => {
    ((item && item.content) || []).forEach((inner) => {
      if (inner && inner.type === 'text') parts.push(inner.text || '');
    });
  });
  return parts.join('');
}

/** RawSessionEvent → 归一化事件，规则与 GatewayModels.RawSessionEvent 一致。 */
function normalizeRawEvent(raw, sessionId) {
  const data = raw.data || {};
  const turn = data.turn;
  const step = data.step;
  const type = raw.type;
  let event;

  switch (type) {
    case 'user/message': {
      // source 可能是纯字符串或 {kind} 对象（对齐 dsh-mobile GatewayEventSourceSerializer）
      let source = null;
      if (typeof data.source === 'string') source = data.source;
      else if (data.source && typeof data.source.kind === 'string') source = data.source.kind;
      let text = textBlocks(data.content);
      // 兜底：文本可能挂在 text / message / item.text / parts 等字段（不同连接器版本不一）
      if (!text && typeof data.text === 'string') text = data.text;
      if (!text && data.message) text = textBlocks(data.message);
      if (!text && data.item) text = textBlocks(data.item);
      if (!text && Array.isArray(data.parts)) {
        text = data.parts
          .map((pt) => (typeof pt === 'string' ? pt : (pt && pt.text) || ''))
          .join('');
      }
      event = {
        type: type,
        text: text,
        source: source,
        images: imageBlocks(data.content)
      };
      break;
    }
    case 'assistant/chunk': {
      const chunk = data.chunk || {};
      let tool = null;
      if (chunk.type === 'tool-call-delta') {
        tool = { id: chunk.id || null, name: chunk.name || null, argumentsDelta: chunk.argumentsDelta || null };
      }
      let chunkText = typeof chunk.text === 'string' ? chunk.text : '';
      if (!chunkText && typeof chunk.delta === 'string') chunkText = chunk.delta;
      if (!chunkText && typeof chunk.content === 'string') chunkText = chunk.content;
      event = {
        type: type,
        turn: turn,
        step: step,
        text: chunkText,
        chunkType: chunk.type,
        tool: tool,
        usage: chunk.usage,
        finish: chunk.reason ? { kind: chunk.reason.kind } : null
      };
      break;
    }
    case 'assistant/message': {
      const msgContent = data.message && data.message.content;
      const blocks = Array.isArray(msgContent)
        ? msgContent
        : (typeof msgContent === 'string' ? [{ type: 'text', text: msgContent }] : []);
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('');
      const reasoning = blocks.filter((b) => b.type === 'reasoning').map((b) => b.text || '').join('');
      const calls = blocks
        .filter((b) => b.type === 'tool-call' && b.id && b.name)
        .map((b) => ({ id: b.id, name: b.name, arguments: b.arguments }));
      event = {
        type: type,
        turn: turn,
        step: step,
        text: text,
        reasoning: reasoning,
        toolCalls: calls,
        images: imageBlocks(data.message),
        interrupted: data.interrupted === true
      };
      break;
    }
    case 'assistant/attempt': {
      event = { type: type, turn: turn, step: step };
      break;
    }
    case 'status':
    case 'command/started':
    case 'command/completed':
    case 'command/failed':
    case 'compaction/started':
    case 'compaction/summarized': {
      const commandId = data.commandId || (data.raw && data.raw.commandId) || null;
      event = {
        type: 'status',
        commandId: commandId,
        name: data.name || (data.raw && data.raw.name) || 'command',
        phase: type,
        shadowedItems: data.shadowedItemCount || (data.raw && data.raw.shadowedItemCount) || null,
        shadowedTokens: data.shadowedTokenCount || (data.raw && data.raw.shadowedTokenCount) || null
      };
      break;
    }
    case 'tool/call': {
      event = {
        type: type,
        turn: turn,
        step: step,
        callId: data.callId,
        name: data.name,
        arguments: data.arguments
      };
      break;
    }
    case 'tool/result': {
      const content = (data.message && data.message.content) || [];
      const isError = (data.error !== undefined && data.error !== null && data.error !== false) ||
        content.some((b) => b && b.type === 'tool-result' && b.isError === true);
      event = {
        type: type,
        turn: turn,
        step: step,
        callId: data.message && data.message.source && data.message.source.callId,
        isError: isError,
        preview: toolResultText(data.message)
      };
      break;
    }
    case 'tool/code-dispatch-start':
    case 'tool/code-dispatch': {
      event = {
        type: type,
        name: data.name,
        arguments: data.arguments,
        isError: data.isError === true,
        preview: type === 'tool/code-dispatch' ? textBlocks({ content: data.content }) : null,
        rootCallId: data.rootCallId,
        parentCallId: data.parentCallId,
        subCallId: data.subCallId
      };
      break;
    }
    case 'turn/start':
    case 'turn/end':
    case 'step/start':
    case 'step/end': {
      const reason = typeof data.reason === 'string' ? data.reason : (data.reason && data.reason.kind);
      event = { type: type, turn: turn, step: step, reason: reason };
      break;
    }
    case 'session/title': {
      event = { type: type, text: data.title };
      break;
    }
    default: {
      event = {
        type: type,
        turn: turn,
        step: step,
        text: data.text,
        name: data.name,
        isError: data.error !== undefined && data.error !== null && data.error !== false,
        error: typeof data.error === 'string' ? data.error : undefined,
        outcome: data.outcome,
        sourceEventSeq: data.sourceEventSeq,
        compactionId: data.compactionId,
        sourceCommandId: data.sourceCommandId,
        shadowedItemCount: data.shadowedItemCount,
        shadowedTokenCount: data.shadowedTokenCount
      };
      break;
    }
  }

  event.turn = event.turn !== undefined ? event.turn : turn;
  event.step = event.step !== undefined ? event.step : step;
  event.raw = data;
  return {
    sessionId: sessionId,
    seq: raw.seq,
    time: raw.time,
    dateMs: eventDateMs(raw.time),
    event: event
  };
}

// ---------- 对话投影 ----------
//
// 把事件流折叠成可阅读的对话条目。分组策略对齐 iOS ConversationViewport：
// 用户消息独立成行；assistant/message 聚合成正文 + 思考 + 工具调用；
// tool/result 按 callId 归并进对应工具行；实时 chunk 追加到流式尾部。

const TITLES = {
  user: '你',
  streaming: 'whaletail · 正在生成',
  streamingReasoning: 'Think · 正在推理',
  assemblingTool: 'Tool Call · 正在组装',
  toolDone: '工具完成',
  toolFailed: '工具失败'
};

// 工具图标映射与 DSH processToolIcon 对齐。
function toolIconFile(name) {
  const n = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['write', 'edit', 'writefile', 'editfile', 'applypatch'].indexOf(n) >= 0) return 'dsh-edit.svg';
  if (['glob', 'grep', 'websearch'].indexOf(n) >= 0) return 'dsh-search.svg';
  if (['read', 'readfile', 'webfetch', 'cordispackageinspect', 'cordisruntimeinspect'].indexOf(n) >= 0) return 'dsh-read.svg';
  if (['bash', 'pwsh'].indexOf(n) >= 0) return 'dsh-bash.svg';
  return 'dsh-process-tool.svg';
}

function eventIconFile(event) {
  const type = event.type || '';
  const n = (event.name || '').toLowerCase();
  if (type.indexOf('tool/code-dispatch') === 0) return 'braces-orange';
  if (n.indexOf('think') >= 0) return 'think-purple';
  if (n.indexOf('context') >= 0) return 'context-green';
  if (n.indexOf('status') >= 0 || n.indexOf('plan') >= 0 || n.indexOf('terminal') >= 0) return 'terminal-gray';
  return event.isError === true ? 'excla-circle-red' : 'antenna-ocean';
}

function newAggregator() {
  return { rows: [], byCallId: {}, currentAssistant: null, lastTurn: null };
}

function pushRow(agg, row) {
  agg.rows.push(row);
  return row;
}

function ensureAssistant(agg, sessionId, seq, turn, startNewAfterSettlement) {
  const current = agg.currentAssistant;
  const shouldStartNew = !!(startNewAfterSettlement && current && current.settled &&
    (current.text || current.reasoning || current.tools.length));
  if (!current || current.turn !== turn || shouldStartNew) {
    agg.currentAssistant = {
      kind: 'assistant',
      key: 'a-' + seq + '-' + (turn === undefined ? 'x' : turn),
      turn: turn,
      title: '',
      reasoning: '',
      text: '',
      tools: [],
      events: [],          // 按事件顺序的思考/工具日志（对齐 DSH 过程组扁平列表）
      streaming: false,
      reasoningStreaming: false,
      settled: false,
      seq: seq,
      sessionId: sessionId,
      markdown: null
    };
    pushRow(agg, agg.currentAssistant);
  }
  return agg.currentAssistant;
}

/** 过程组日志：思考块（相邻合并），对齐 DSH「思考」行 */
function journalThink(assistant, text) {
  if (!text) return;
  const last = assistant.events[assistant.events.length - 1];
  if (last && last.kind === 'think') {
    last.text += text;
  } else {
    assistant.events.push({ kind: 'think', text: text });
  }
}

/** 过程组日志：工具块（按 callId 去重，保持首现顺序） */
function journalTool(assistant, callId) {
  const key = callId || '';
  const exists = assistant.events.some((ev) => ev.kind === 'tool' && (ev.callId || '') === key && key !== '');
  if (!exists) assistant.events.push({ kind: 'tool', callId: callId || null });
}

function toolRowForCall(agg, assistant, callId, name) {
  const key = callId || name || 'tool';
  let tool = agg.byCallId[key];
  if (!tool || assistant.tools.indexOf(tool) < 0) {
    tool = {
      kind: 'tool',
      key: 't-' + key + '-' + assistant.seq,
      callId: callId || null,
      name: name || 'tool',
      title: TITLES.assemblingTool,
      argumentsText: '',
      resultText: '',
      status: 'running',
      isError: false,
      collapsed: true,
      iconFile: toolIconFile(name)
    };
    agg.byCallId[key] = tool;
    assistant.tools.push(tool);
  }
  if (name && !tool.name) tool.name = name;
  tool.iconFile = toolIconFile(tool.name);
  return tool;
}

/** 实时事件写入聚合器；返回是否有可见变化。 */
function applyEvent(agg, normalized) {
  const event = normalized.event;
  const sessionId = normalized.sessionId;
  const seq = normalized.seq;
  switch (event.type) {
    case 'user/message': {
      agg.currentAssistant = null;
      // 对齐 dsh-mobile ConversationProjection：只有 source 为空或 'user' 的才是用户消息，
      // 其余（system 注入、插件等）作为上下文条目展示，不再冒充用户气泡。
      if (event.source !== null && event.source !== 'user') {
        if (!event.text) return false;
        pushRow(agg, {
          kind: 'context',
          key: 'ctx-' + seq,
          title: '上下文' + (event.source ? ' · ' + event.source : ''),
          text: event.text || '',
          seq: seq
        });
        return true;
      }
      // 乐观回显合并：本地待确认行 + 同文本/空回显 → 就地 adoption，避免双气泡
      const last = agg.rows.length ? agg.rows[agg.rows.length - 1] : null;
      if (last && last.kind === 'user' && last.pending &&
          (!(event.text || '') || (event.text || '') === (last.text || ''))) {
        last.pending = false;
        last.key = 'u-' + seq;
        last.seq = seq;
        if (event.images && event.images.length) last.images = event.images;
        return true;
      }
      pushRow(agg, {
        kind: 'user',
        key: 'u-' + seq,
        title: TITLES.user,
        text: event.text || '',
        images: event.images || [],
        seq: seq
      });
      return true;
    }
    case 'assistant/chunk': {
      const assistant = ensureAssistant(agg, sessionId, seq, event.turn, true);
      const ct = String(event.chunkType || 'text');
      if (event.text) {
        // 思考流（reasoning/thinking 类块）：进过程组日志；正文流进回答文本
        if (ct.indexOf('reason') === 0 || ct.indexOf('think') === 0) {
          assistant.reasoning += event.text;
          assistant.reasoningStreaming = true;
          assistant.title = assistant.title || TITLES.streamingReasoning;
          journalThink(assistant, event.text);
        } else {
          assistant.text += event.text;
          assistant.streaming = true;
          assistant.title = TITLES.streaming;
        }
      }
      if (event.tool && event.tool.argumentsDelta) {
        const tool = toolRowForCall(agg, assistant, event.tool.id, event.tool.name);
        tool.argumentsText += event.tool.argumentsDelta;
        tool.title = TITLES.assemblingTool;
        journalTool(assistant, event.tool.id || null);
      }
      return true;
    }
    case 'assistant/message': {
      let assistant = agg.currentAssistant;
      const hasFreshContent = !!(event.text || event.reasoning);
      const completedPreviousStep = assistant && assistant.settled &&
        assistant.tools.some((tool) => tool.status === 'done' || tool.status === 'error');
      const differentSettledText = assistant && assistant.settled && hasFreshContent &&
        ((event.text && event.text !== assistant.text) || (event.reasoning && event.reasoning !== assistant.reasoning));
      assistant = ensureAssistant(
        agg, sessionId, seq, event.turn, completedPreviousStep || differentSettledText
      );
      assistant.streaming = false;
      assistant.reasoningStreaming = false;
      assistant.title = '';
      if (event.text) assistant.text = event.text;
      if (event.reasoning) {
        // 结算思考：流式已记录则合并去重（整体替换首块），否则补一条日志
        const thinkCount = assistant.events.filter((ev) => ev.kind === 'think').length;
        if (!thinkCount) journalThink(assistant, event.reasoning);
        else assistant.reasoning = event.reasoning;
        if (!assistant.reasoning) assistant.reasoning = event.reasoning;
      }
      (event.toolCalls || []).forEach((call) => {
        const tool = toolRowForCall(agg, assistant, call.id, call.name);
        tool.argumentsText = jsonDisplayText(call.arguments, true) || tool.argumentsText;
        tool.title = TITLES.assemblingTool;
        journalTool(assistant, call.id || null);
      });
      assistant.settled = true;
      return true;
    }
    case 'status': {
      const key = 'cmd-' + (event.commandId || seq);
      let status = agg.statusRows ? agg.statusRows[key] : null;
      if (!status) {
        if (!agg.statusRows) agg.statusRows = {};
        status = agg.statusRows[key] = {
          kind: 'status',
          key: key,
          title: event.name || 'command',
          text: '正在执行…',
          seq: seq
        };
        pushRow(agg, status);
        return true;
      }
      // 更新已有状态行
      if (event.phase === 'compaction/started') status.text = '正在压缩…';
      else if (event.phase === 'command/completed') status.text = '已完成';
      else if (event.phase === 'command/failed') status.text = '执行失败';
      else if (event.phase === 'compaction/summarized') {
        status.text = (event.shadowedItems != null && event.shadowedTokens != null)
          ? '已压缩 ' + event.shadowedItems + ' 条历史记录（约 ' + event.shadowedTokens + ' tokens）'
          : '已完成';
      }
      return true;
    }
    case 'tool/call': {
      const assistant = ensureAssistant(agg, sessionId, seq, event.turn);
      const tool = toolRowForCall(agg, assistant, event.callId, event.name);
      tool.argumentsText = jsonDisplayText(event.arguments, true) || tool.argumentsText;
      journalTool(assistant, event.callId || null);
      return true;
    }
    case 'tool/result': {
      const assistant = ensureAssistant(agg, sessionId, seq, event.turn);
      const tool = toolRowForCall(agg, assistant, event.callId, null);
      tool.status = 'done';
      tool.isError = event.isError === true;
      tool.iconFile = toolIconFile(tool.name);
      tool.title = tool.isError ? TITLES.toolFailed : TITLES.toolDone;
      tool.resultText = event.preview || '';
      journalTool(assistant, event.callId || null);
      return true;
    }
    case 'turn/start':
    case 'turn/end':
    case 'step/start':
    case 'step/end':
    case 'assistant/attempt':
    case 'agent/inbox/spliced':
    case 'compaction/start':
    case 'compaction/end':
    case 'request/header':
    case 'session/title':
      // 结构性/内部事件不进会话行（对齐 dsh-mobile ConversationProjection）
      return false;
    default:
      // 白名单制：只有 user/assistant/tool 五种内容事件生成会话行，
      // 其余所有协议内部事件（permission/preset、sandbox/mode、
      // approval/policy、model/selection、command/done、system/message 等）
      // 一律不进会话行（对齐 dsh-mobile 只渲染用户/助手/工具/系统）
      return false;
  }
}

/** 历史页重建：events 为已按 seq 升序排列的 RawSessionEvent 数组。 */
function buildRows(events, sessionId) {
  const agg = newAggregator();
  events.forEach((raw) => {
    applyEvent(agg, normalizeRawEvent(raw, sessionId));
  });
  return agg.rows;
}

// ---------- 轨迹投影 ----------

/**
 * 轨迹条目：Turn 分组 + USER/ASSISTANT/TOOL 徽标 + #seq。
 * 与 iOS TrajectoryView 的信息结构一致。
 */
function buildTrajectory(events, sessionId) {
  const items = [];
  const toolItemsByCallId = {};
  // turn 向前填充：user/message 可能不带 turn，归入其后第一个带 turn 的
  // 事件所属回合，保证 Turn 分组头出现在该回合的 USER 行之前。
  const effectiveTurns = new Array(events.length).fill(null);
  let nextTurn = null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const t = events[i].data && events[i].data.turn;
    if (t !== undefined && t !== null) nextTurn = t;
    effectiveTurns[i] = nextTurn;
  }
  let currentTurn = null;
  events.forEach((raw, index) => {
    const normalized = normalizeRawEvent(raw, sessionId);
    const event = normalized.event;
    const turn = effectiveTurns[index];
    if (turn !== undefined && turn !== null && turn !== currentTurn) {
      currentTurn = turn;
      items.push({ kind: 'turn', key: 'turn-' + turn + '-' + raw.seq, label: '请求 #' + turn });
    }
    let badge = null;
    let label = '';
    let preview = '';
    switch (event.type) {
      case 'user/message':
        badge = 'USER';
        label = '';
        preview = oneLine(event.text || '', 36);
        break;
      case 'assistant/message':
        badge = 'ASSISTANT';
        label = event.toolCalls && event.toolCalls.length && !event.text ? '(tool call only)' : '';
        preview = oneLine(event.text || event.reasoning || '', 36);
        break;
      case 'assistant/chunk':
        return; // 流式增量不进轨迹
      case 'tool/call':
        badge = 'TOOL';
        label = event.name || 'tool';
        preview = oneLine(jsonDisplayText(event.arguments, false) || '', 36);
        break;
      case 'tool/result': {
        const toolItem = event.callId ? toolItemsByCallId[event.callId] : null;
        if (toolItem) {
          toolItem.resultPreview = oneLine(event.preview || '', 80);
          toolItem.preview = [toolItem.preview, toolItem.resultPreview]
            .filter(Boolean).join(' → ');
          toolItem.isError = event.isError === true;
          toolItem.statusLabel = event.isError ? '失败' : '完成';
          toolItem.detail = [toolItem.detail, jsonDisplayText(event.raw, true)]
            .filter(Boolean).join('\n\n--- result ---\n');
        }
        return;
      }
      case 'turn/start':
      case 'turn/end':
      case 'step/start':
      case 'step/end':
      case 'assistant/attempt':
        return; // 结构性事件由 Turn 分组表达
      default:
        badge = 'EVENT';
        label = event.name || event.type;
        preview = oneLine(event.text || event.error || '', 36);
    }
    if (!badge) return;
    const dotClass = badge === 'USER' ? 'dot-user'
      : badge === 'ASSISTANT' ? 'dot-assistant'
      : badge === 'TOOL' ? 'dot-tool'
      : 'dot-event';
    const item = {
      kind: 'event',
      key: 'ev-' + raw.seq,
      badge: badge,
      badgeClass: badge.toLowerCase(),
      dotClass: dotClass,
      label: label,
      preview: preview,
      seq: raw.seq,
      time: normalized.dateMs,
      detail: jsonDisplayText(event.raw, true),
      callId: event.callId || null,
      eventType: event.type
    };
    items.push(item);
    if (event.type === 'tool/call' && event.callId) toolItemsByCallId[event.callId] = item;
  });
  return items;
}

module.exports = {
  normalizeRawEvent,
  buildRows,
  buildTrajectory,
  applyEvent,
  newAggregator,
  TITLES
};
