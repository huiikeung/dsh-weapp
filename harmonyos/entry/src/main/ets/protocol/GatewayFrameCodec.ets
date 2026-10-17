/**
 * Gateway 帧解码器 —— ArkTS 版
 * 对照 GatewayDtos.kt 中的 RawSessionEvent.normalized / GatewayEventSourceSerializer，
 * 以及 GatewayRuntime 的帧 schema 校验入口。
 *
 * 语义：
 * - 宽松解码：未知字段忽略、可选字段缺失不报错（对齐 kotlinx 宽松配置）。
 * - fail-closed：`kind` 缺失或非 string 的帧直接抛 GatewayFrameError，
 *   不得进入 UI 或 I/O（对齐 ARCHITECTURE.md 的 Adapter fail-closed 要求）。
 */

import {
  GatewayEvent, GatewayFrame, GatewayImageAttachment, RawSessionEvent,
  SessionEvent, ToolCall, ToolDelta, FinishInfo
} from './GatewayDtos';

export class GatewayFrameError extends Error {
  constructor(message: string) {
    super(message);
  }
}

type Rec = Record<string, Object>;

/** ---- 宽松取值辅助（对应 JsonValue 的 stringValue/doubleValue/booleanValue/arrayValue） ---- */

export function isObj(v: Object | undefined | null): v is Rec {
  return v !== undefined && v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function asRec(v: Object | undefined | null): Rec | undefined {
  return isObj(v) ? (v as Rec) : undefined;
}

export function str(o: Object | undefined | null, key: string): string | undefined {
  const r = asRec(o);
  if (r === undefined) {
    return undefined;
  }
  const v = r[key];
  return typeof v === 'string' ? v : undefined;
}

export function num(o: Object | undefined | null, key: string): number | undefined {
  const r = asRec(o);
  if (r === undefined) {
    return undefined;
  }
  const v = r[key];
  return typeof v === 'number' ? v : undefined;
}

export function bool(o: Object | undefined | null, key: string): boolean | undefined {
  const r = asRec(o);
  if (r === undefined) {
    return undefined;
  }
  const v = r[key];
  return typeof v === 'boolean' ? v : undefined;
}

export function arr(o: Object | undefined | null, key: string): Object[] | undefined {
  const r = asRec(o);
  if (r === undefined) {
    return undefined;
  }
  const v = r[key];
  return Array.isArray(v) ? (v as Object[]) : undefined;
}

export function isNullValue(v: Object | undefined | null): boolean {
  return v === undefined || v === null;
}

/** ---- 帧解码 ---- */

/**
 * 解码一帧 Gateway JSON 文本。
 * - JSON 语法错误 → GatewayFrameError（对应 decode 抛错）
 * - kind 缺失/非 string → GatewayFrameError（fail-closed）
 */
export function decodeFrame(text: string): GatewayFrame {
  let parsed: Object;
  try {
    parsed = JSON.parse(text) as Object;
  } catch (e) {
    throw new GatewayFrameError(`invalid JSON frame: ${String(e)}`);
  }
  const rec = asRec(parsed);
  if (rec === undefined) {
    throw new GatewayFrameError('frame is not a JSON object');
  }
  const kind = rec['kind'];
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new GatewayFrameError(`frame missing string kind: ${text.substring(0, 120)}`);
  }
  // GatewayFrame 的所有字段均为可选；解析结果直接以该接口视角使用，
  // 需要动态访问的字段经 str/num/bool/arr 辅助函数宽松取值。
  return parsed as GatewayFrame;
}

/** ---- GatewayEventSourceSerializer 归一化 ---- */

/**
 * 事件流 `source` 兼容两种形态：WebUI 简化后的字符串、Host 原样下发的
 * `{ kind: ... }` 对象。统一归一化为 kind 字符串，其余形态丢弃，
 * 避免一条新事件破坏整个 WebSocket 解码。
 */
export function normalizeEventSource(v: Object | undefined): string | undefined {
  if (typeof v === 'string') {
    return v;
  }
  return str(v, 'kind');
}

/** ---- RawSessionEvent.normalized(sessionId) ---- */

function joinTextBlocks(value: Object | undefined): string {
  const list = Array.isArray(value) ? (value as Object[]) : (arr(value, 'content') ?? []);
  const parts: string[] = [];
  for (const b of list) {
    if (str(b, 'type') === 'text') {
      const t = str(b, 'text');
      if (t !== undefined) {
        parts.push(t);
      }
    }
  }
  return parts.join('');
}

function imageBlocks(value: Object | undefined): GatewayImageAttachment[] {
  const list = Array.isArray(value) ? (value as Object[]) : (arr(value, 'content') ?? []);
  const out: GatewayImageAttachment[] = [];
  for (const block of list) {
    if (str(block, 'type') !== 'image') {
      continue;
    }
    const attachment = asRec(block['attachment']);
    if (attachment === undefined) {
      continue;
    }
    const attachmentId = str(attachment, 'attachmentId');
    const mediaType = str(attachment, 'mediaType');
    const bytes = num(attachment, 'bytes');
    const width = num(attachment, 'width');
    const height = num(attachment, 'height');
    if (attachmentId === undefined || mediaType === undefined ||
      bytes === undefined || width === undefined || height === undefined) {
      continue;
    }
    out.push({
      attachmentId, mediaType, bytes, width, height,
      name: str(attachment, 'name')
    });
  }
  return out;
}

function toolResultText(message: Object | undefined): string {
  const content = arr(message, 'content') ?? [];
  const parts: string[] = [];
  for (const block of content) {
    for (const inner of (arr(block, 'content') ?? [])) {
      if (str(inner, 'type') === 'text') {
        const t = str(inner, 'text');
        if (t !== undefined) {
          parts.push(t);
        }
      }
    }
  }
  return parts.join('');
}

function isErrorValue(v: Object | undefined | null): boolean {
  return !(v === undefined || v === null || v === false);
}

/** RawSessionEvent.normalized(sessionId)：把 Host 原始事件归一化为 GatewayEvent。 */
export function normalizeRawSessionEvent(raw: RawSessionEvent, sessionId: string): SessionEvent {
  const data = raw.data;
  const turn = num(data, 'turn');
  const step = num(data, 'step');
  const type = raw.type;

  const partial: Partial<GatewayEvent> = {};
  if (turn !== undefined) {
    partial.turn = turn;
  }
  if (step !== undefined) {
    partial.step = step;
  }

  let ev: GatewayEvent;
  switch (type) {
    case 'user/message': {
      ev = {
        type,
        ...partial,
        text: joinTextBlocks(data['content']),
        source: normalizeEventSource(asRec(data['source'])?.['kind']),
        images: imageBlocks(data['content']),
        raw: data
      };
      break;
    }
    case 'assistant/chunk': {
      const chunk = asRec(data['chunk']);
      const chunkType = str(chunk, 'type');
      let tool: ToolDelta | undefined;
      if (chunkType === 'tool-call-delta') {
        tool = {
          id: str(chunk, 'id'),
          name: str(chunk, 'name'),
          argumentsDelta: str(chunk, 'argumentsDelta')
        };
      }
      const finishKind = str(asRec(chunk?.['reason']), 'kind');
      ev = {
        type,
        ...partial,
        text: str(chunk, 'text'),
        chunkType,
        tool,
        usage: chunk?.['usage'],
        finish: finishKind !== undefined ? { kind: finishKind } : undefined,
        raw: data
      };
      break;
    }
    case 'assistant/message': {
      const content = data['message'] !== undefined ? arr(data['message'], 'content') : undefined;
      const blocks = content ?? [];
      let text = '';
      let reasoning = '';
      const toolCalls: ToolCall[] = [];
      for (const block of blocks) {
        const bt = str(block, 'type');
        if (bt === 'text') {
          text += str(block, 'text') ?? '';
        } else if (bt === 'reasoning') {
          reasoning += str(block, 'text') ?? '';
        } else if (bt === 'tool-call') {
          const id = str(block, 'id');
          const name = str(block, 'name');
          if (id !== undefined && name !== undefined) {
            toolCalls.push({ id, name, arguments: block['arguments'] });
          }
        }
      }
      const images = content !== undefined ? imageBlocks(content) : imageBlocks(data['message']);
      const interrupted = bool(data, 'interrupted');
      ev = {
        type,
        ...partial,
        text,
        reasoning,
        toolCalls,
        images,
        usage: asRec(data['message'])?.['usage'] ?? data['usage'],
        interrupted,
        stream: data['stream'],
        raw: data
      };
      break;
    }
    case 'tool/call': {
      ev = {
        type,
        ...partial,
        callId: str(data, 'callId'),
        name: str(data, 'name'),
        arguments: data['arguments'],
        raw: data
      };
      break;
    }
    case 'tool/result': {
      const message = asRec(data['message']);
      let isError = isErrorValue(data['error']);
      if (!isError) {
        for (const block of (arr(message, 'content') ?? [])) {
          if (str(block, 'type') === 'tool-result' && bool(block, 'isError') === true) {
            isError = true;
            break;
          }
        }
      }
      ev = {
        type,
        ...partial,
        callId: str(asRec(message?.['source']), 'callId'),
        isError,
        preview: toolResultText(message),
        raw: data
      };
      break;
    }
    case 'tool/code-dispatch-start':
    case 'tool/code-dispatch': {
      ev = {
        type,
        ...partial,
        name: str(data, 'name'),
        arguments: data['arguments'],
        isError: bool(data, 'isError'),
        preview: joinTextBlocks(data['content']),
        rootCallId: str(data, 'rootCallId'),
        parentCallId: str(data, 'parentCallId'),
        subCallId: str(data, 'subCallId'),
        raw: data
      };
      break;
    }
    case 'turn/start':
    case 'turn/end':
    case 'step/start':
    case 'step/end': {
      ev = {
        type,
        ...partial,
        reason: str(asRec(data['reason']), 'kind'),
        raw: data
      };
      break;
    }
    case 'assistant/attempt': {
      ev = { type, ...partial, stream: data['stream'], raw: data };
      break;
    }
    case 'session/title': {
      ev = { type, ...partial, text: str(data, 'title'), raw: data };
      break;
    }
    default: {
      const errorVal = data['error'];
      ev = {
        type,
        ...partial,
        text: str(data, 'text'),
        name: str(data, 'name'),
        isError: isErrorValue(errorVal),
        commandId: str(data, 'commandId'),
        args: str(data, 'args'),
        outcome: str(data, 'outcome'),
        sourceEventSeq: num(data, 'sourceEventSeq'),
        compactionId: str(data, 'compactionId'),
        sourceCommandId: str(data, 'sourceCommandId'),
        shadowedItemCount: num(data, 'shadowedItemCount'),
        shadowedTokenCount: num(data, 'shadowedTokenCount'),
        error: str(data, 'error'),
        raw: data
      };
      break;
    }
  }

  const out: SessionEvent = { sessionId, seq: raw.seq, time: raw.time, event: ev };
  return out;
}

export { FinishInfo };
