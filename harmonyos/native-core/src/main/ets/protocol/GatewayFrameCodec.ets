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
  GatewayEvent, GatewayFileAttachment, GatewayFrame, GatewayImageAttachment, GatewayPresentedFile, RawSessionEvent,
  SessionEvent, ToolCall, ToolDelta, FinishInfo
} from './GatewayDtos';

export class GatewayFrameError extends Error {
  constructor(message: string) {
    super(message);
  }
}

type Rec = Record<string, Object>;

/** ---- 宽松取值辅助（对应 JsonValue 的 stringValue/doubleValue/booleanValue/arrayValue） ---- */

export function isObj(v: Object | undefined | null): boolean {
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

/** 任意对象按字段取值（ArkTS 不允许对 Object 直接下标访问）。 */
export function field(o: Object | undefined | null, key: string): Object | undefined {
  const r = asRec(o);
  return r === undefined ? undefined : r[key];
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
  const kind = field(rec, 'kind');
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

/** 递归展开文本：DSH 事件里的正文可能是「分片字符串数组」，层级各版本不一致 */
function textOfValue(value: Object | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value as string;
  }
  if (Array.isArray(value)) {
    let out: string = '';
    for (const one of value as Object[]) {
      out += textOfValue(one);
    }
    return out;
  }
  const rec: Record<string, Object> = value as Record<string, Object>;
  const inner: Object | undefined = rec['text'] ?? rec['delta'] ?? rec['content'] ?? rec['chunks'] ?? rec['parts'];
  if (inner !== undefined) {
    return textOfValue(inner);
  }
  return '';
}

function joinTextBlocks(value: Object | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value as string;
  }
  const list: Object[] = Array.isArray(value) ? (value as Object[]) : [value as Object];
  let out: string = '';
  for (const b of list) {
    if (b === undefined || b === null) {
      continue;
    }
    if (typeof b === 'string') {
      out += b as string;
      continue;
    }
    const rec: Record<string, Object> = b as Record<string, Object>;
    const type: string | undefined = str(rec, 'type');
    if (type !== undefined && type !== 'text') {
      continue;
    }
    // text 可能是字符串，也可能是「分片字符串数组」：只认 string 会把数组形态整段丢掉，
    // 于是每条回复只剩每段开头一小截（要重进页面才完整）。
    out += textOfValue(rec);
  }
  return out;
}

function imageBlocks(value: Object | undefined): GatewayImageAttachment[] {
  const list = Array.isArray(value) ? (value as Object[]) : (arr(value, 'content') ?? []);
  const out: GatewayImageAttachment[] = [];
  for (const block of list) {
    if (str(block, 'type') !== 'image') {
      continue;
    }
    const attachment = asRec(field(block, 'attachment'));
    if (attachment === undefined) {
      continue;
    }
    // 只要求 attachmentId：历史帧里网关常常只给 attachmentId + mediaType，
    // 不带 bytes/width/height（小程序 protocol.js 的 imageBlocks 同样不要求这几个字段）。
    // 之前严格要求五个字段齐全，缺一个就整块丢弃 → 历史消息的图直接变成「没有图」。
    const attachmentId = str(attachment, 'attachmentId');
    if (attachmentId === undefined || attachmentId.length === 0) {
      continue;
    }
    const mediaType = str(attachment, 'mediaType') ?? str(attachment, 'mimeType') ?? 'image/jpeg';
    const bytes = num(attachment, 'bytes');
    const width = num(attachment, 'width');
    const height = num(attachment, 'height');
    out.push({
      attachmentId, mediaType, bytes: bytes === undefined ? 0 : bytes,
      width: width === undefined ? 0 : width, height: height === undefined ? 0 : height,
      name: str(attachment, 'name')
    });
  }
  return out;
}

/** 文件附件块：type='file' 的 content 块（对齐小程序 item.attachments）。 */
function fileBlocks(value: Object | undefined): GatewayFileAttachment[] {
  const list = Array.isArray(value) ? (value as Object[]) : (arr(value, 'content') ?? []);
  const out: GatewayFileAttachment[] = [];
  for (const block of list) {
    if (str(block, 'type') !== 'file') {
      continue;
    }
    const attachment = asRec(field(block, 'attachment'));
    if (attachment === undefined) {
      continue;
    }
    const name: string | undefined = str(attachment, 'name') ?? str(attachment, 'path');
    if (name === undefined) {
      continue;
    }
    out.push({
      attachmentId: str(attachment, 'attachmentId'),
      name: name,
      path: str(attachment, 'path'),
      mediaType: str(attachment, 'mediaType'),
      bytes: num(attachment, 'bytes'),
      kind: str(attachment, 'kind')
    });
  }
  return out;
}

/**
 * 顶层附件数组（data.attachments / message.attachments）：不同连接器版本会把图片/文件挂在
 * 这里而不是 content 块里（对齐小程序 protocol.js：attachmentBlocks(content).concat(data.attachments)）。
 */
function topLevelFileBlocks(data: Object | undefined): GatewayFileAttachment[] {
  const out: GatewayFileAttachment[] = [];
  const list: Object[] = arr(data, 'attachments') ?? [];
  for (const entry of list) {
    const rec: Record<string, Object> | undefined = asRec(field(entry, 'attachment')) ?? asRec(entry);
    if (rec === undefined) {
      continue;
    }
    const name: string | undefined = str(rec, 'name') ?? str(rec, 'path');
    if (name === undefined) {
      continue;
    }
    out.push({
      attachmentId: str(rec, 'attachmentId'),
      name: name,
      path: str(rec, 'path'),
      mediaType: str(rec, 'mediaType'),
      bytes: num(rec, 'bytes'),
      kind: str(rec, 'kind')
    });
  }
  return out;
}

/** 顶层图片数组（data.images）：直接给出 attachmentId/mediaType，无嵌套 attachment。 */
function topLevelImageBlocks(data: Object | undefined): GatewayImageAttachment[] {
  const out: GatewayImageAttachment[] = [];
  const list: Object[] = arr(data, 'images') ?? [];
  for (const entry of list) {
    const rec: Record<string, Object> | undefined = asRec(field(entry, 'attachment')) ?? asRec(entry);
    if (rec === undefined) {
      continue;
    }
    const id: string | undefined = str(rec, 'attachmentId') ?? str(rec, 'id');
    if (id === undefined || id.length === 0) {
      continue;
    }
    const mediaType: string = str(rec, 'mediaType') ?? str(rec, 'mimeType') ?? 'image/jpeg';
    out.push({
      attachmentId: id,
      mediaType: mediaType,
      bytes: num(rec, 'bytes') ?? 0,
      width: num(rec, 'width') ?? 0,
      height: num(rec, 'height') ?? 0,
      name: str(rec, 'name')
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
      // 正文/附件兜底：不同连接器版本把内容放在 content / text / message 里（对齐小程序 normalizeRawEvent）
      let userText: string = joinTextBlocks(field(data, 'content'));
      if (userText.length === 0) {
        const flat: string | undefined = str(data, 'text');
        if (flat !== undefined) {
          userText = flat;
        }
      }
      if (userText.length === 0 && field(data, 'message') !== undefined) {
        userText = joinTextBlocks(field(data, 'message'));
      }
      ev = {
        type,
        turn: partial.turn,
        step: partial.step,
        text: userText,
        // source 可能是字符串（'dsh-ops:step-tail'）也可能是 { kind } 对象。
        // 之前只认后者，字符串来源会被当成「无来源」→ 上下文注入被误判成用户消息
        // （于是注入内容以「我发送的蓝色气泡」出现）。
        source: normalizeEventSource(
          typeof field(data, 'source') === 'string'
            ? (field(data, 'source') as string)
            : (field(asRec(field(data, 'source')), 'kind') ?? field(asRec(field(data, 'message')), 'source'))),
        images: imageBlocks(field(data, 'content')).concat(topLevelImageBlocks(data)),
        attachments: fileBlocks(field(data, 'content')).concat(topLevelFileBlocks(data)),
        raw: data
      };
      break;
    }
    case 'assistant/chunk': {
      const chunk = asRec(field(data, 'chunk'));
      const chunkType = str(chunk, 'type');
      let tool: ToolDelta | undefined;
      if (chunkType === 'tool-call-delta') {
        // 有的实现用 id，有的用 callId / toolCallId：统一兼容，否则流式行和 tool/call 对不上号
        const deltaId: string = str(chunk, 'id') ?? '';
        const deltaCallId: string = str(chunk, 'callId') ?? '';
        const deltaToolCallId: string = str(chunk, 'toolCallId') ?? '';
        tool = {
          id: deltaId.length > 0 ? deltaId : (deltaCallId.length > 0 ? deltaCallId : deltaToolCallId),
          name: str(chunk, 'name'),
          argumentsDelta: str(chunk, 'argumentsDelta')
        };
      }
      const finishKind = str(asRec(field(chunk, 'reason')), 'kind');
      ev = {
        type,
        turn: partial.turn,
        step: partial.step,
        text: str(chunk, 'text'),
        chunkType,
        tool,
        usage: field(chunk, 'usage'),
        finish: finishKind !== undefined ? { kind: finishKind } : undefined,
        raw: data
      };
      break;
    }
    case 'assistant/message': {
      const content = field(data, 'message') !== undefined ? arr(field(data, 'message'), 'content') : undefined;
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
            toolCalls.push({ id, name, arguments: field(block, 'arguments') });
          }
        }
      }
      const messageObj: Object | undefined = field(data, 'message');
      const images = (content !== undefined ? imageBlocks(content) : imageBlocks(messageObj))
        .concat(topLevelImageBlocks(data))
        .concat(topLevelImageBlocks(messageObj));
      const attachments = (content !== undefined ? fileBlocks(content) : fileBlocks(messageObj))
        .concat(topLevelFileBlocks(data))
        .concat(topLevelFileBlocks(messageObj));
      const interrupted = bool(data, 'interrupted');
      ev = {
        type,
        turn: partial.turn,
        step: partial.step,
        text,
        reasoning,
        toolCalls,
        images,
        attachments: attachments,
        usage: field(asRec(field(data, 'message')), 'usage') ?? field(data, 'usage'),
        interrupted,
        stream: field(data, 'stream'),
        raw: data
      };
      break;
    }
    case 'tool/call': {
      ev = {
        type,
        turn: partial.turn,
        step: partial.step,
        callId: str(data, 'callId'),
        name: str(data, 'name'),
        arguments: field(data, 'arguments'),
        raw: data
      };
      break;
    }
    case 'tool/result': {
      const message = asRec(field(data, 'message'));
      let isError = isErrorValue(field(data, 'error'));
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
        turn: partial.turn,
        step: partial.step,
        callId: str(asRec(field(message, 'source')), 'callId'),
        isError,
        preview: toolResultText(message),
        appendOrigin: bool(data, 'appendOrigin') === true,
        mutationPath: str(data, 'mutationPath'),
        raw: data
      };
      break;
    }
    case 'workspace/changes': {
      ev = {
        type,
        turn: partial.turn,
        step: partial.step,
        valid: bool(data, 'valid') !== false,
        raw: data
      };
      break;
    }
    case 'deliverables/presented': {
      const files = arr(data, 'files') ?? [];
      const presented: GatewayPresentedFile[] = [];
      for (const file of files) {
        const path: string | undefined = str(file, 'path');
        if (path === undefined || path.length === 0) {
          continue;
        }
        presented.push({
          path: path,
          name: str(file, 'name'),
          added: num(file, 'added'),
          deleted: num(file, 'deleted'),
          status: str(file, 'status'),
          description: str(file, 'description'),
          index: num(file, 'index')
        });
      }
      ev = {
        type,
        turn: partial.turn,
        step: partial.step,
        presentedFiles: presented,
        raw: data
      };
      break;
    }
    case 'tool/code-dispatch-start':
    case 'tool/code-dispatch':
    case 'tool/ptc-dispatch-start':
    case 'tool/ptc-dispatch': {
      ev = {
        type,
        turn: partial.turn,
        step: partial.step,
        name: str(data, 'name'),
        arguments: field(data, 'arguments'),
        isError: bool(data, 'isError'),
        preview: joinTextBlocks(field(data, 'content')),
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
        turn: partial.turn,
        step: partial.step,
        reason: str(asRec(field(data, 'reason')), 'kind'),
        raw: data
      };
      break;
    }
    case 'assistant/attempt': {
      ev = { type, turn: partial.turn,
        step: partial.step, stream: field(data, 'stream'), raw: data };
      break;
    }
    case 'session/title': {
      ev = { type, turn: partial.turn,
        step: partial.step, text: str(data, 'title'), raw: data };
      break;
    }
    default: {
      const errorVal = field(data, 'error');
      ev = {
        type,
        turn: partial.turn,
        step: partial.step,
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
