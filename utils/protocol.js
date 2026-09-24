// Gateway 事件归一化与对话/轨迹投影。
// 与 shared/protocol + projection 的语义对齐：user/message、assistant/chunk、
// assistant/message、tool/call、tool/result 等事件的字段提取规则一致。

const { jsonDisplayText, oneLine, eventDateMs } = require('./util');

// ---------- 事件归一化 ----------

function textBlocks(value) {
  const blocks = Array.isArray(value) ? value : ((value && value.content) || []);
  return blocks
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text || '')
    .join('');
}

function imageBlocks(value) {
  const blocks = (value && value.content) || [];
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
      const source = data.source && data.source.kind;
      event = {
        type: type,
        text: textBlocks(data.content),
        source: typeof source === 'string' ? source : null,
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
      event = {
        type: type,
        turn: turn,
        step: step,
        text: chunk.text,
        chunkType: chunk.type,
        tool: tool,
        usage: chunk.usage,
        finish: chunk.reason ? { kind: chunk.reason.kind } : null
      };
      break;
    }
    case 'assistant/message': {
      const blocks = (data.message && data.message.content) || [];
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
  streaming: 'DeepSeek · 正在生成',
  streamingReasoning: 'Think · 正在推理',
  assemblingTool: 'Tool Call · 正在组装',
  toolDone: '工具完成',
  toolFailed: '工具失败'
};

// 图标文件映射：对齐 iOS conversationToolGlyph / eventIcon（SF Symbols → PNG 资产）。
function toolIconFile(name, isError) {
  if (isError) return 'triangle-red';
  const n = (name || '').toLowerCase();
  if (n.indexOf('bash') >= 0) return 'bash-orange';
  if (n.indexOf('read') >= 0) return 'read-orange';
  if (n.indexOf('search') >= 0 || n.indexOf('grep') >= 0 || n.indexOf('glob') >= 0) return 'search-orange';
  if (n.indexOf('write') >= 0 || n.indexOf('edit') >= 0) return 'pencil-orange';
  return 'wrench-orange';
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

function ensureAssistant(agg, sessionId, seq, turn) {
  if (!agg.currentAssistant || agg.currentAssistant.turn !== turn) {
    agg.currentAssistant = {
      kind: 'assistant',
      key: 'a-' + seq + '-' + (turn === undefined ? 'x' : turn),
      turn: turn,
      title: '',
      reasoning: '',
      text: '',
      tools: [],
      streaming: false,
      reasoningStreaming: false,
      seq: seq,
      sessionId: sessionId,
      markdown: null
    };
    pushRow(agg, agg.currentAssistant);
  }
  return agg.currentAssistant;
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
      iconFile: toolIconFile(name, false)
    };
    agg.byCallId[key] = tool;
    assistant.tools.push(tool);
  }
  if (name && !tool.name) tool.name = name;
  tool.iconFile = toolIconFile(tool.name, tool.isError);
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
      const assistant = ensureAssistant(agg, sessionId, seq, event.turn);
      if (event.text) {
        assistant.text += event.text;
        assistant.streaming = true;
        assistant.title = TITLES.streaming;
      }
      if (event.tool && event.tool.argumentsDelta) {
        const tool = toolRowForCall(agg, assistant, event.tool.id, event.tool.name);
        tool.argumentsText += event.tool.argumentsDelta;
        tool.title = TITLES.assemblingTool;
      }
      return true;
    }
    case 'assistant/message': {
      const assistant = ensureAssistant(agg, sessionId, seq, event.turn);
      assistant.streaming = false;
      assistant.title = '';
      if (event.text) assistant.text = event.text;
      if (event.reasoning) assistant.reasoning = event.reasoning;
      (event.toolCalls || []).forEach((call) => {
        const tool = toolRowForCall(agg, assistant, call.id, call.name);
        tool.argumentsText = jsonDisplayText(call.arguments, true) || tool.argumentsText;
        tool.title = TITLES.assemblingTool;
      });
      return true;
    }
    case 'tool/call': {
      const assistant = ensureAssistant(agg, sessionId, seq, event.turn);
      const tool = toolRowForCall(agg, assistant, event.callId, event.name);
      tool.argumentsText = jsonDisplayText(event.arguments, true) || tool.argumentsText;
      return true;
    }
    case 'tool/result': {
      const assistant = ensureAssistant(agg, sessionId, seq, event.turn);
      const tool = toolRowForCall(agg, assistant, event.callId, null);
      tool.status = 'done';
      tool.isError = event.isError === true;
      tool.iconFile = toolIconFile(tool.name, tool.isError);
      tool.title = tool.isError ? TITLES.toolFailed : TITLES.toolDone;
      tool.resultText = event.preview || '';
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
    default: {
      if (event.text && event.type === 'session/title') return false;
      pushRow(agg, {
        kind: 'event',
        key: 'e-' + seq,
        type: event.type,
        title: event.name || event.type,
        text: oneLine(event.text || event.preview || event.error || '', 80),
        isError: event.isError === true,
        iconFile: eventIconFile(event),
        seq: seq
      });
      return true;
    }
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
      items.push({ kind: 'turn', key: 'turn-' + turn + '-' + raw.seq, label: 'Turn ' + turn });
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
        // 工具结果并入轨迹（iOS 显示完成态），但不重复徽标名。
        badge = 'TOOL';
        label = event.isError ? '失败' : '结果';
        preview = oneLine(event.preview || '', 36);
        break;
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
    items.push({
      kind: 'event',
      key: 'ev-' + raw.seq,
      badge: badge,
      badgeClass: badge.toLowerCase(),
      dotClass: dotClass,
      label: label,
      preview: preview,
      seq: raw.seq,
      time: normalized.dateMs,
      detail: jsonDisplayText(event.raw, true)
    });
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
