import { SessionEvent } from '../protocol/GatewayDtos';
import { Logger } from '../common/Logger';
import { asRec, str, num } from '../protocol/GatewayFrameCodec';

/**
 * 合成流式事件（assistant-stream 增量）的 seq 保留区起点。
 * 真实事件 seq 从 0 单调递增，永远到不了这个区间；合成事件在这个区间里严格递增，
 * 于是既不会和真实事件撞号（撞号会把那条真实事件从 sequenceMap 里顶掉），
 * 也不会被当成历史事件写进 records / sequenceMap（历史重放与合并只认真实事件）。
 */
export const CONVERSATION_LIVE_SEQ_BASE: number = 900000;

export enum ConversationItemKind { USER='USER', CONTEXT='CONTEXT', ASSISTANT='ASSISTANT', REASONING='REASONING', TOOL='TOOL', JSON_TOOL='JSON_TOOL', TOOL_RESULT='TOOL_RESULT', GENERATED_IMAGES='GENERATED_IMAGES', STATUS='STATUS', SYSTEM='SYSTEM', CHANGES='CHANGES', FILES='FILES' }
/** 交付/编辑文件（对齐小程序 delivered-file / changed-file 卡片） */
export interface PresentedFile {
  name: string;
  path?: string;
  mediaType?: string;
  bytes?: number;
  /** 变更行数（+N / −N） */
  added?: number;
  deleted?: number;
  /** 状态补充文案（如「已格式化」） */
  status?: string;
}
export interface GatewayTextPart { type: string; text: string; }
export interface ConversationItem {
  id: string; kind: ConversationItemKind; title: string; text: string;
  images?: Object[]; attachments?: Object[]; isError?: boolean; epochSeconds: number; turn?: number;
  files?: PresentedFile[]; knownFiles?: PresentedFile[]; textParts?: GatewayTextPart[]; requestId?: string;
  /** 工具调用（对齐小程序 tool 行：callId 关联调用与结果，depth 决定子步骤缩进） */
  callId?: string;
  parentCallId?: string;
  rootCallId?: string;
  subCallId?: string;
  /** 0 = 顶层工具；>0 = run_code/PTC 派生的子步骤（对齐 .tool-node 缩进与竖线） */
  depth?: number;
  /** running | done | error（对齐小程序 tool.status） */
  status?: string;
  /** 调用参数原文（展开后的「调用参数」段） */
  argumentsText?: string;
  /** 工具结果原文（展开后的「结果」段） */
  resultText?: string;
  /** 图片数量（本地乐观回显时没有真实 images 数组，只记数量） */
  imageCount?: number;
  /** 本地乐观回显的图片 URI（发送瞬间用本地缩略图，真实 images 到达后由 images 接管） */
  localImagePaths?: string[];
  /** CHANGES 行对应的 workspace/changes 事件 seq（用于拉取文件变更摘要） */
  changeSeq?: number;
}
export interface ConversationProjectionOperation { kind: string; item?: ConversationItem; itemId?: string; delta?: string; epochSeconds?: number; items?: ConversationItem[]; }
export interface AssistantChunkProjection { time: number; chunk: Object; }
export interface ConversationProjectionLabels {
  userMessage?: string; context?: string; streamingAssistant?: string; streamingReasoning?: string;
  finalAssistant?: string; finalReasoning?: string; assemblingTool?: string;
  toolResultDone?: string; toolResultFailed?: string;
  commandRunning?: string; commandCompacting?: string; commandCompleted?: string; commandFailed?: string;
  compactedHistory?: string; interrupted?: string;
  modelAttemptFailed?: string; modelRetrying?: string; modelRetried?: string;
  generationFailed?: string; generationCancelled?: string; outputTruncated?: string;
}
export interface ConversationHistoryRebase { events: Object[]; liveTail: Object[]; operationCount: number; }
export class ConversationProjector {
  private mutableItems: ConversationItem[] = [];
  private records: SessionEvent[] = [];
  private sequenceMap: Map<number, SessionEvent> = new Map();
  private streamIndexes: Map<string, number> = new Map();
  private finalizedKeys: Set<string> = new Set();
  /** 流式正文的完整累积文本：只把「完整行」提交上屏，避免逐字符重排导致的闪烁 */
  private streamBuffers: Map<string, string> = new Map<string, string>();
  /** 每个流式行已提交到 item 的字符数：append 是「追加」语义，只能传新增那一段 */
  private streamCommitted: Map<string, number> = new Map<string, number>();
  /** callId → 工具行 id / 深度（对齐小程序 agg.byCallId：结果并入工具行、子步骤按 parent 深度缩进） */
  private toolItemIds: Map<string, string> = new Map();
  private toolDepths: Map<string, number> = new Map();
  private labels: ConversationProjectionLabels;
  /** 当前轮次：给不带 turn 的事件（部分工具/结果帧）继承，保证过程组按轮隔离不来回跳 */
  private currentTurn: number = -1;
  lastSequence: number = -1;
  constructor(labels: ConversationProjectionLabels = {}) { this.labels = labels; }
  get items(): ConversationItem[] { return this.mutableItems.slice(); }
  get hasAssistantChunks(): boolean { return this.streamIndexes.size > 0; }
  reset(): void { this.mutableItems = []; this.records = []; this.sequenceMap.clear(); this.streamIndexes.clear(); this.finalizedKeys.clear(); this.toolItemIds.clear(); this.toolDepths.clear(); this.lastSequence = -1; }
  rebuild(events: SessionEvent[]): void { this.reset(); const sorted = events.slice().sort((a: SessionEvent,b: SessionEvent) => a.seq-b.seq); for (const event of sorted) this.fold(event); }
  fold(record: SessionEvent): ConversationProjectionOperation[] {
    if (!Number.isSafeInteger(record.seq) || record.seq < 0) return [];
    // 流式增量是合成事件：只叠加到当前投影，不进 records / sequenceMap。
    // 以前它们复用「最近一条真实事件」的 seq，fold 会走 sequenceMap 覆盖 + 整表重放，
    // 把那条真实事件（本轮用户消息、上一轮已完成的最终答复）顶掉，表现就是
    // 「新消息被塞进上一轮已完成的回合里，本轮只剩运行状态条」。
    if (record.seq >= CONVERSATION_LIVE_SEQ_BASE) {
      const liveOperations: ConversationProjectionOperation[] = [];
      this.project(record, liveOperations);
      return liveOperations;
    }
    const existing = this.sequenceMap.get(record.seq);
    if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(record)) return [];
    if (record.seq <= this.lastSequence || existing !== undefined) {
      this.sequenceMap.set(record.seq, record);
      this.records = Array.from(this.sequenceMap.values()).sort((a: SessionEvent,b: SessionEvent) => a.seq-b.seq);
      this.rebuildFromRecords();
      return [{ kind: 'replaceAll', items: this.items }];
    }
    this.sequenceMap.set(record.seq, record); this.records.push(record);
    const operations: ConversationProjectionOperation[] = []; this.project(record, operations);
    this.lastSequence = record.seq; return operations;
  }
  foldWithOperations(events: SessionEvent[]): ConversationProjectionOperation[] {
    const out: ConversationProjectionOperation[] = [];
    const sorted = events.slice().sort((a: SessionEvent, b: SessionEvent) => a.seq - b.seq);
    for (const event of sorted) {
      for (const operation of this.fold(event)) out.push(operation);
    }
    return out;
  }

  replaceSteeringMessages(events: SessionEvent[]): ConversationProjectionOperation[] {
    this.reset();
    return this.foldWithOperations(events);
  }

  rebase(history: SessionEvent[], liveTail: SessionEvent[]): ConversationHistoryRebase {
    this.rebuild(history);
    const operations = this.foldWithOperations(liveTail);
    const rebase: ConversationHistoryRebase = { events: history.slice() as Object[], liveTail: liveTail.slice() as Object[], operationCount: operations.length };
    return rebase;
  }

  label(key: string, fallback: string): string {
    const labels = this.labels as Object as Record<string, Object>;
    const value = labels[key];
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  }

  private upsertStatus(id: string, title: string, text: string, date: number, isError: boolean, out: ConversationProjectionOperation[]): void {
    const index = this.mutableItems.findIndex((item: ConversationItem) => item.id === id);
    const item: ConversationItem = { id: id, kind: ConversationItemKind.STATUS, title: title, text: text, isError: isError, epochSeconds: date };
    if (index >= 0) { this.mutableItems[index] = item; out.push({ kind: 'replace', item: item, itemId: id }); }
    else this.insert(item, out);
  }

  compactedHistoryText(items: number, tokens: number): string {
    return this.label('compactedHistory', 'Compacted {items} history items (~{tokens} tokens)')
      .replace('{items}', String(items)).replace('{tokens}', String(tokens));
  }

  foldAssistantChunks(attemptId: string, chunks: AssistantChunkProjection[]): ConversationProjectionOperation[] {
    const out: ConversationProjectionOperation[] = [];
    for (const row of chunks) {
      const type = str(row.chunk, 'type'); const name = str(row.chunk, 'name');
      if (type !== 'text-delta' && type !== 'reasoning-delta' && type !== 'tool-call-delta') continue;
      const kind = type === 'text-delta' ? ConversationItemKind.ASSISTANT : type === 'reasoning-delta' ? ConversationItemKind.REASONING : (name?.toLowerCase() === 'run_code' ? ConversationItemKind.JSON_TOOL : ConversationItemKind.TOOL);
      const suffix = str(row.chunk, 'index') ?? str(row.chunk, 'id') ?? '0';
      const key = 'live-' + attemptId + '-' + type + '-' + suffix;
      const text = str(row.chunk, type === 'tool-call-delta' ? 'argumentsDelta' : 'text') ?? '';
      this.append(key, kind, kind === ConversationItemKind.ASSISTANT ? (this.labels.streamingAssistant ?? 'DeepSeek') : kind === ConversationItemKind.REASONING ? (this.labels.streamingReasoning ?? 'Think') : (name ?? this.labels.assemblingTool ?? 'Tool'), text, row.time, out);
    }
    return out;
  }

  /**
   * 回合收尾：把还没结算的流式行就地定稿（改标题、退出流式索引），而不是整行删掉。
   * 以前这里直接 clear：网关的 assistant/message 不带推理文本、或回合被中断时，
   * 已经流式显示出来的「思考 / 正文」会在收尾瞬间整行消失，看起来就是「行没显示全」。
   */
  settleLiveRows(): ConversationProjectionOperation[] {
    const out: ConversationProjectionOperation[] = [];
    const keys: string[] = [];
    this.streamIndexes.forEach((value: number, key: string) => { keys.push(key); });
    for (const key of keys) {
      const index: number = this.streamIndexes.get(key) === undefined ? -1 : (this.streamIndexes.get(key) as number);
      if (index < 0 || index >= this.mutableItems.length) {
        this.streamIndexes.delete(key);
        continue;
      }
      const old: ConversationItem = this.mutableItems[index];
      this.streamIndexes.delete(key);
      if (old.text.length === 0) {
        continue;
      }
      let title: string = old.title;
      if (key.indexOf('stream-text-') === 0) {
        title = this.labels.finalAssistant ?? 'DeepSeek';
      } else if (key.indexOf('stream-reason-') === 0) {
        title = this.labels.finalReasoning ?? 'Think';
      } else if (key.indexOf('stream-tool-') === 0) {
        title = old.title;
      }
      const next: ConversationItem = {
        id: old.id, kind: old.kind, title: title, text: old.text, images: old.images,
        attachments: old.attachments, isError: old.isError, epochSeconds: old.epochSeconds, turn: old.turn,
        files: old.files, knownFiles: old.knownFiles, textParts: old.textParts, requestId: old.requestId,
        callId: old.callId, parentCallId: old.parentCallId, rootCallId: old.rootCallId, subCallId: old.subCallId,
        depth: old.depth, status: old.status, argumentsText: old.argumentsText, resultText: old.resultText,
        imageCount: old.imageCount, changeSeq: old.changeSeq
      };
      this.mutableItems[index] = next;
      out.push({ kind: 'replace', item: next, itemId: next.id });
    }
    return out;
  }

  clearAssistantChunks(): ConversationProjectionOperation[] {
    const out: ConversationProjectionOperation[] = [];
    for (const key of this.streamIndexes.keys()) { const index=this.streamIndexes.get(key); if(index!==undefined){const item=this.mutableItems[index]; this.mutableItems.splice(index,1); this.streamIndexes.delete(key); out.push({kind:'remove',itemId:item.id});} }
    return out;
  }
  private rebuildFromRecords(): void { const events = this.records.slice(); this.mutableItems=[]; this.streamIndexes.clear(); this.finalizedKeys.clear(); this.lastSequence=-1; this.currentTurn=-1; for(const record of events){this.project(record,[]);this.lastSequence=Math.max(this.lastSequence,record.seq);} }
  /** 「已编辑文件 / 交付文件」行：同一回合内合并，按 path 去重 */
  private upsertFilesItem(id: string, kind: ConversationItemKind, turn: number | undefined, date: number,
    out: ConversationProjectionOperation[], files: PresentedFile[]): void {
    const index: number = this.mutableItems.findIndex((row: ConversationItem) =>
      row.kind === kind && row.turn === turn);
    if (index >= 0) {
      const old: ConversationItem = this.mutableItems[index];
      const merged: PresentedFile[] = (old.files ?? []).slice();
      for (const file of files) {
        const existing: number = merged.findIndex((item: PresentedFile) => item.path === file.path);
        if (existing >= 0) {
          merged[existing] = file;
        } else {
          merged.push(file);
        }
      }
      const next: ConversationItem = {
        id: old.id, kind: old.kind, title: old.title, text: '', epochSeconds: old.epochSeconds,
        turn: old.turn, files: merged, isError: old.isError
      };
      this.mutableItems[index] = next;
      out.push({ kind: 'replace', item: next, itemId: next.id });
      return;
    }
    const item: ConversationItem = {
      id: id + '-' + kind,
      kind: kind,
      title: kind === ConversationItemKind.CHANGES ? '已编辑文件' : '交付文件',
      text: '',
      epochSeconds: date,
      turn: turn,
      files: files
    };
    this.insert(item, out);
  }

  private project(record: SessionEvent, out: ConversationProjectionOperation[]): void {
    const e=record.event; const step=e.step ?? -1; const date=ConversationProjector.epoch(record.time); const id=record.sessionId+'-'+record.seq;
    // 轮次继承：先取事件自身 turn，没有就沿用上一条已知轮次。
    // 同一轮里有的帧带 turn、有的不带（工具/结果帧常见）。若流式 key 用原始 turn，
    // 缺 turn 的帧会全挤进 "-1" 这个槽、跨轮复用同一个气泡，界面就出现
    // 「一会儿显示上一轮、一会儿上一轮和这一轮混在一起」的错乱。
    const effectiveTurn: number | undefined = e.turn !== undefined ? e.turn : (this.currentTurn >= 0 ? this.currentTurn : undefined);
    if (e.turn !== undefined) {
      this.currentTurn = e.turn;
    }
    const turn: number = effectiveTurn !== undefined ? effectiveTurn : -1;
    const key=turn+'-'+step;
    if(e.type==='user/message') {
      let kind=e.source===undefined||e.source==='user'?ConversationItemKind.USER:ConversationItemKind.CONTEXT;
      // 兜底：网关某些版本不带 source。注入内容有明显的形态特征（以 '[' 开头的插件/时间上下文、
      // 或者 <path> 图片块），这类绝不能当成「用户发送的消息」渲染成蓝色气泡。
      if (kind === ConversationItemKind.USER) {
        const sniff: string = (e.text ?? '').trim();
        if (sniff.startsWith('[') || sniff.startsWith('<path>')
          || sniff.indexOf('Plugin context') >= 0 || sniff.indexOf('Time sampled') >= 0) {
          kind = ConversationItemKind.CONTEXT;
        }
      }
      if((e.text??'').length===0 && (e.images?.length??0)===0 && (e.attachments?.length??0)===0) return;
      const rawUserText: string = e.text ?? '';
      const userText: string = this.stripImageBlocks(rawUserText);
      // 纯图片块描述（视觉输入）不产生会话行，否则会渲染成一坨 XML 气泡
      if (userText.length === 0 && rawUserText.length > 0 && (e.images?.length ?? 0) === 0) {
        return;
      }
      const item:ConversationItem={id,kind,title:kind===ConversationItemKind.USER?(this.labels.userMessage??'You'):(this.labels.context??'Context · ')+(e.source??'Context'),text:userText,images:e.images as Object[]|undefined,attachments:e.attachments as Object[]|undefined,epochSeconds:date,turn:effectiveTurn};
      this.insert(item,out);
      // 人工用户消息 = 新回合边界：它常不带 turn。不在这里切断继承的话，
      // 新回合里同样不带 turn 的帧会继承上一轮 turn，新过程会被并进上一轮的「已完成」。
      if (e.turn === undefined && (e.source === undefined || e.source === 'user')) {
        this.currentTurn = -1;
      }
      return;
    }
    if(e.type==='assistant/chunk') {
      if(this.finalizedKeys.has(key)) return;
      const chunk=e.chunkType; if(chunk==='text-delta'||chunk==='text') this.appendStreamText(this.resolveStreamKey('stream-text-',turn,step),ConversationItemKind.ASSISTANT,this.labels.streamingAssistant??'DeepSeek',e.text??'',date,out);
      else if(chunk==='reasoning-delta'||chunk==='reasoning') this.appendStreamText(this.resolveStreamKey('stream-reason-',turn,step),ConversationItemKind.REASONING,this.labels.streamingReasoning??'Think',e.text??'',date,out);
      else if(chunk==='tool-call-delta') { const name=e.tool?.name??this.labels.assemblingTool??'Tool'; this.append('stream-tool-'+(e.tool?.id??key),name.toLowerCase()==='run_code'?ConversationItemKind.JSON_TOOL:ConversationItemKind.TOOL,name,e.tool?.argumentsDelta??'',date,out); }
      return;
    }
    if(e.type==='assistant/message') {
      this.finalizedKeys.add(key);
      if(e.reasoning!==undefined && e.reasoning.length>0) this.finalize(this.resolveStreamKey('stream-reason-',turn,step),{id:id+'-reason',kind:ConversationItemKind.REASONING,title:this.labels.finalReasoning??'Think',text:e.reasoning,isError:e.interrupted,epochSeconds:date,turn:effectiveTurn},out);
      if((e.text??'').length>0 || (e.images?.length??0)>0 || (e.attachments?.length??0)>0) this.finalizeAssistantText(this.resolveStreamKey('stream-text-',turn,step),{id,kind:ConversationItemKind.ASSISTANT,title:e.interrupted===true?(this.labels.interrupted??'Generation interrupted'):(this.labels.finalAssistant??'DeepSeek'),text:e.text??'',images:e.images as Object[]|undefined,attachments:e.attachments as Object[]|undefined,isError:e.interrupted,epochSeconds:date,turn:effectiveTurn},out);
      return;
    }
    if (e.type === 'workspace/changes') {
      Logger.info('[CHANGES] event seq=' + record.seq + ' valid=' + (e.valid === false ? 'false' : 'true')
        + ' turn=' + (e.turn ?? -1));
      if (e.valid === false) return;
      this.upsertFilesItem(id, ConversationItemKind.CHANGES, effectiveTurn, date, out, []);
      const last: number = this.mutableItems.length - 1;
      if (last >= 0 && this.mutableItems[last].kind === ConversationItemKind.CHANGES) {
        this.mutableItems[last].changeSeq = record.seq;
      }
      return;
    }
    if (e.type === 'deliverables/presented') {
      const presented = e.presentedFiles ?? [];
      if (presented.length === 0) return;
      const files: PresentedFile[] = [];
      for (const file of presented) {
        const name: string = file.name !== undefined && file.name.length > 0
          ? file.name : (file.path.split('/').pop() ?? file.path);
        files.push({ name: name, path: file.path, added: file.added, deleted: file.deleted, status: file.status });
      }
      this.upsertFilesItem(id, ConversationItemKind.FILES, effectiveTurn, date, out, files);
      return;
    }
    if(e.type==='tool/call') {
      const name=e.name??'Tool';
      const argsText=ConversationProjector.argumentsText(e.arguments);
      const callId=e.callId??'';
      const item:ConversationItem={id,kind:name.toLowerCase()==='run_code'?ConversationItemKind.JSON_TOOL:ConversationItemKind.TOOL,title:name,text:argsText,epochSeconds:date,turn:effectiveTurn,callId:callId,argumentsText:argsText,status:'running',depth:0};
      if(callId.length>0){this.toolItemIds.set(callId,id);this.toolDepths.set(callId,0);}
      this.insert(item,out); return;
    }
    if(e.type==='tool/result') {
      // 结果并入对应工具行（对齐小程序：结果不单独占一行，展开时显示在「结果」段）
      const callId=e.callId??'';
      const targetId=callId.length>0?this.toolItemIds.get(callId):undefined;
      const index=targetId!==undefined?this.mutableItems.findIndex((row:ConversationItem)=>row.id===targetId):-1;
      const preview=e.preview??e.outcome??'';
      if(index>=0){
        const old:ConversationItem=this.mutableItems[index];
        const next:ConversationItem={id:old.id,kind:old.kind,title:old.title,text:old.text,images:old.images,isError:e.isError===true,epochSeconds:old.epochSeconds,turn:old.turn,callId:old.callId,parentCallId:old.parentCallId,rootCallId:old.rootCallId,subCallId:old.subCallId,depth:old.depth,status:e.isError===true?'error':'done',argumentsText:old.argumentsText,resultText:preview};
        this.mutableItems[index]=next; out.push({kind:'replace',item:next,itemId:next.id}); return;
      }
      this.insert({id,kind:ConversationItemKind.TOOL_RESULT,title:e.isError===true?(this.labels.toolResultFailed??'Tool failed'):(this.labels.toolResultDone??'Tool result'),text:preview,isError:e.isError,epochSeconds:date,turn:effectiveTurn,callId:callId},out);
      if (e.appendOrigin === true && (e.mutationPath ?? '').length > 0 && (e.turn ?? 0) > 0) {
        const mutationPath: string = e.mutationPath as string;
        this.upsertFilesItem(id, ConversationItemKind.CHANGES, effectiveTurn, date, out,
          [{ name: mutationPath.split('/').pop() ?? mutationPath, path: mutationPath }]);
      }
      return;
    }
    if(e.type==='tool/code-dispatch-start'||e.type==='tool/code-dispatch'||e.type==='tool/ptc-dispatch-start'||e.type==='tool/ptc-dispatch') {
      // PTC 子步骤：root/parent/sub 三级 callId，深度 = 父步骤深度 + 1（对齐小程序 tool.depth）
      const subCallId=e.subCallId??'';
      const parentCallId=e.parentCallId??'';
      const rootCallId=e.rootCallId??'';
      const name=e.name??'tool';
      const argsText=ConversationProjector.argumentsText(e.arguments);
      const start=e.type==='tool/code-dispatch-start'||e.type==='tool/ptc-dispatch-start';
      const depth=parentCallId.length>0&&this.toolDepths.has(parentCallId)?(this.toolDepths.get(parentCallId)??0)+1:1;
      const preview=start?'':(e.preview??'');
      const existingId=subCallId.length>0?this.toolItemIds.get(subCallId):undefined;
      const existingIndex=existingId!==undefined?this.mutableItems.findIndex((row:ConversationItem)=>row.id===existingId):-1;
      if(existingIndex>=0){
        const old:ConversationItem=this.mutableItems[existingIndex];
        const next:ConversationItem={id:old.id,kind:old.kind,title:old.title,text:argsText.length>0?argsText:old.text,images:old.images,isError:start?old.isError:(e.isError===true),epochSeconds:old.epochSeconds,turn:old.turn,callId:subCallId,parentCallId:parentCallId,rootCallId:rootCallId,subCallId:subCallId,depth:old.depth,status:start?'running':(e.isError===true?'error':'done'),argumentsText:argsText.length>0?argsText:old.argumentsText,resultText:start?old.resultText:preview};
        this.mutableItems[existingIndex]=next; out.push({kind:'replace',item:next,itemId:next.id}); return;
      }
      const item:ConversationItem={id,kind:name.toLowerCase()==='run_code'?ConversationItemKind.JSON_TOOL:ConversationItemKind.TOOL,title:name,text:argsText,epochSeconds:date,turn:effectiveTurn,callId:subCallId,parentCallId:parentCallId,rootCallId:rootCallId,subCallId:subCallId,depth:depth,argumentsText:argsText,status:start?'running':(e.isError===true?'error':'done'),resultText:preview};
      if(subCallId.length>0){this.toolItemIds.set(subCallId,id);this.toolDepths.set(subCallId,depth);}
      this.insert(item,out); return;
    }
    if(e.type==='turn/end') { const reason=e.reason??''; const title=reason==='error'||reason==='failed'?(this.labels.generationFailed??'Generation failed'):(['aborted','cancelled','canceled'].indexOf(reason)>=0?(this.labels.generationCancelled??'Generation cancelled'):reason==='interrupted'?(this.labels.interrupted??'Generation interrupted'):''); if(title.length>0) this.insert({id,kind:ConversationItemKind.SYSTEM,title,text:e.error??'',isError:reason==='error'||reason==='failed'||reason==='interrupted',epochSeconds:date,turn:effectiveTurn},out); }
    const ext = asRec(e as Object);
    const extLine: string = ext === undefined ? '' : str(ext, 'line') ?? '';
    const extResult: string = ext === undefined ? '' : str(ext, 'result') ?? '';
    if (e.type === 'command/started') this.upsertStatus('command-' + (e.commandId ?? key), this.label('commandRunning', 'Running…'), extLine, date, false, out);
    if (e.type === 'command/compacting') this.upsertStatus('compaction-' + (e.commandId ?? key), this.label('commandCompacting', 'Compacting…'), '', date, false, out);
    if (e.type === 'command/completed') this.upsertStatus('command-' + (e.commandId ?? key), this.label('commandCompleted', 'Completed'), extResult, date, false, out);
    if (e.type === 'command/failed') this.upsertStatus('command-' + (e.commandId ?? key), this.label('commandFailed', 'Failed'), e.error ?? '', date, true, out);
    if (e.type === 'context/compacted') {
      const compact = asRec(e as Object);
      const items: number = compact === undefined ? 0 : num(compact, 'items') ?? 0;
      const tokens: number = compact === undefined ? 0 : num(compact, 'tokens') ?? 0;
      this.insert({ id: id, kind: ConversationItemKind.STATUS, title: this.compactedHistoryText(items, tokens), text: '', epochSeconds: date, turn: effectiveTurn }, out);
    }
    if (e.type === 'model/attempt-failed') this.insert({ id: id, kind: ConversationItemKind.STATUS, title: this.label('modelAttemptFailed', 'Model request failed'), text: e.error ?? '', isError: true, epochSeconds: date, turn: effectiveTurn }, out);
    if (e.type === 'model/retrying') this.insert({ id: id, kind: ConversationItemKind.STATUS, title: this.label('modelRetrying', 'Retrying model request'), text: '', epochSeconds: date, turn: effectiveTurn }, out);
    if (e.type === 'model/retried') this.insert({ id: id, kind: ConversationItemKind.STATUS, title: this.label('modelRetried', 'Model request retried'), text: '', epochSeconds: date, turn: effectiveTurn }, out);
  }
  /**
   * 去掉「图片块」的文本描述（视觉输入在文本通道里是 <path>…</path><type>image</type><content>…</content>）。
   * 之前这些串被当成普通正文渲染，聊天里就冒出一坨 XML 气泡 —— 正好在 Agent 读图/抓图的回合，
   * 也就是「回复文本变成发送文本」的现象。
   */
  private stripImageBlocks(text: string): string {
    if (text.indexOf('<type>image</type>') < 0) {
      return text;
    }
    let out: string = text;
    let guard: number = 0;
    while (guard < 20) {
      guard += 1;
      const marker: number = out.indexOf('<type>image</type>');
      if (marker < 0) {
        break;
      }
      let start: number = marker;
      const pathOpen: number = out.lastIndexOf('<path>', marker);
      if (pathOpen >= 0 && marker - pathOpen < 260) {
        start = pathOpen;
      }
      const close: number = out.indexOf('</content>', marker);
      const end: number = close >= 0 ? close + 10 : marker + 18;
      out = (out.substring(0, start) + out.substring(end)).trim();
    }
    return out;
  }

  private insert(item:ConversationItem,out:ConversationProjectionOperation[]):void {this.mutableItems.push(item);out.push({kind:'insert',item});}
  private append(key:string,kind:ConversationItemKind,title:string,delta:string,time:number,out:ConversationProjectionOperation[]):void {
    if(delta.length===0)return; const index=this.streamIndexes.get(key);
    if(index!==undefined){const old=this.mutableItems[index];const next:ConversationItem={id:old.id,kind:old.kind,title:old.title,text:old.text+delta,images:old.images,isError:old.isError,epochSeconds:time,turn:old.turn};this.mutableItems[index]=next;out.push({kind:'append',itemId:next.id,delta,epochSeconds:time});}
    else {const item:ConversationItem={id:key,kind,title,text:delta,epochSeconds:time};this.streamIndexes.set(key,this.mutableItems.length);this.insert(item,out);}
  }
  /**
   * 结算最终正文：把流式正文行挪到「本回合过程行之后」。
   * 流式正文是最早出现在本回合里的，工具调用都排在它后面；只在原地 replace 的话，
   * ConversationFeed 会把它当成「回合中段叙述」收进过程组，回合收工折叠成「已完成」时正文就看不见了。
   */
  /**
   * 流式正文行 id：同一回合内复用「已经存在的那一行」。
   * 之前 id 带 step，而流式分片的 step 常常缺失/变化，同一段回复就被切成很多行，
   * 界面上表现为「已完成回复每行只剩几个字」（其实每行是独立的一条 item）。
   */
  /**
   * 流式正文：先累积到缓冲区，只把「完整行」提交上屏。
   * 这样界面是按整行增长，不会每个 delta 都重新换行重排 —— 打字机式逐行出现，不闪。
   */
  private appendStreamText(key: string, kind: ConversationItemKind, title: string, delta: string, epochSeconds: number, out: ConversationProjectionOperation[]): void {
    const accumulated: string = (this.streamBuffers.get(key) ?? '') + delta;
    this.streamBuffers.set(key, accumulated);
    let cut: number = accumulated.lastIndexOf('\n');
    if (cut < 0) {
      // 还没换行：每 40 字符提交一次，避免长时间空白
      cut = Math.floor(accumulated.length / 40) * 40;
      if (cut <= 0) {
        cut = 0;
      }
    } else {
      cut = cut + 1;
    }
    // append 是「追加」语义：只提交比上次多出来的那一段，
    // 否则每提交一次都会把整段前缀再追加一遍 → 正文重复好几份。
    const committed: number = this.streamCommitted.get(key) ?? 0;
    if (cut <= committed) {
      return;
    }
    this.streamCommitted.set(key, cut);
    this.append(key, kind, title, accumulated.substring(committed, cut), epochSeconds, out);
  }

  private resolveStreamKey(prefix: string, turn: number, step: number): string {
    const base: string = prefix + turn + '-';
    for (const item of this.mutableItems) {
      if (item.id.indexOf(base) === 0) {
        return item.id;
      }
    }
    return prefix + turn + '-' + step;
  }

  private finalizeAssistantText(key:string,item:ConversationItem,out:ConversationProjectionOperation[]):void {
    const index=this.streamIndexes.get(key);
    if(index===undefined){this.insert(item,out);return;}
    const old=this.mutableItems[index];
    const next:ConversationItem={id:old.id,kind:item.kind,title:item.title,text:item.text.length>0?item.text:old.text,images:item.images,isError:item.isError,epochSeconds:item.epochSeconds,turn:item.turn};
    this.streamIndexes.delete(key);
    if(index===this.mutableItems.length-1){
      this.mutableItems[index]=next;
      out.push({kind:'replace',item:next,itemId:next.id});
      return;
    }
    this.mutableItems.splice(index,1);
    this.streamIndexes.forEach((value:number,streamKey:string)=>{
      if(value>index){this.streamIndexes.set(streamKey,value-1);}
    });
    this.mutableItems.push(next);
    out.push({kind:'replaceAll',items:this.items});
  }

  private finalize(key:string,item:ConversationItem,out:ConversationProjectionOperation[]):void {
    const index=this.streamIndexes.get(key); if(index===undefined){this.insert(item,out);return;}
    const old=this.mutableItems[index]; const next:ConversationItem={id:old.id,kind:item.kind,title:item.title,text:item.text.length>0?item.text:old.text,images:item.images,isError:item.isError,epochSeconds:item.epochSeconds,turn:item.turn}; this.mutableItems[index]=next;this.streamIndexes.delete(key);out.push({kind:'replace',item:next,itemId:next.id});
  }
  /** 工具参数 → 展示文本：对象走 JSON，字符串原样（对齐小程序 argumentsText）。 */
  private static argumentsText(value:Object|undefined):string{
    if(value===undefined||value===null){return '';}
    if(typeof value==='string'){return value as string;}
    try{return JSON.stringify(value);}catch(err){return '';}
  }
  private static epoch(time:number):number{return time>10000000000?time/1000:time;}
}
