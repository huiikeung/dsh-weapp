import { SessionEvent } from '../protocol/GatewayDtos';
import { Logger } from '../common/Logger';
import { asRec, str, num } from '../protocol/GatewayFrameCodec';

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
  /** callId → 工具行 id / 深度（对齐小程序 agg.byCallId：结果并入工具行、子步骤按 parent 深度缩进） */
  private toolItemIds: Map<string, string> = new Map();
  private toolDepths: Map<string, number> = new Map();
  private labels: ConversationProjectionLabels;
  lastSequence: number = -1;
  constructor(labels: ConversationProjectionLabels = {}) { this.labels = labels; }
  get items(): ConversationItem[] { return this.mutableItems.slice(); }
  get hasAssistantChunks(): boolean { return this.streamIndexes.size > 0; }
  reset(): void { this.mutableItems = []; this.records = []; this.sequenceMap.clear(); this.streamIndexes.clear(); this.finalizedKeys.clear(); this.toolItemIds.clear(); this.toolDepths.clear(); this.lastSequence = -1; }
  rebuild(events: SessionEvent[]): void { this.reset(); const sorted = events.slice().sort((a: SessionEvent,b: SessionEvent) => a.seq-b.seq); for (const event of sorted) this.fold(event); }
  fold(record: SessionEvent): ConversationProjectionOperation[] {
    if (!Number.isSafeInteger(record.seq) || record.seq < 0) return [];
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
  clearAssistantChunks(): ConversationProjectionOperation[] {
    const out: ConversationProjectionOperation[] = [];
    for (const key of this.streamIndexes.keys()) { const index=this.streamIndexes.get(key); if(index!==undefined){const item=this.mutableItems[index]; this.mutableItems.splice(index,1); this.streamIndexes.delete(key); out.push({kind:'remove',itemId:item.id});} }
    return out;
  }
  private rebuildFromRecords(): void { const events = this.records.slice(); this.mutableItems=[]; this.streamIndexes.clear(); this.finalizedKeys.clear(); this.lastSequence=-1; for(const record of events){this.project(record,[]);this.lastSequence=Math.max(this.lastSequence,record.seq);} }
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
    const e=record.event; const turn=e.turn ?? -1; const step=e.step ?? -1; const key=turn+'-'+step; const date=ConversationProjector.epoch(record.time); const id=record.sessionId+'-'+record.seq;
    if(e.type==='user/message') {
      const kind=e.source===undefined||e.source==='user'?ConversationItemKind.USER:ConversationItemKind.CONTEXT;
      if((e.text??'').length===0 && (e.images?.length??0)===0) return;
      const item:ConversationItem={id,kind,title:kind===ConversationItemKind.USER?(this.labels.userMessage??'You'):(this.labels.context??'Context · ')+(e.source??'Context'),text:e.text??'',images:e.images as Object[]|undefined,epochSeconds:date,turn:e.turn};
      this.insert(item,out); return;
    }
    if(e.type==='assistant/chunk') {
      if(this.finalizedKeys.has(key)) return;
      const chunk=e.chunkType; if(chunk==='text-delta') this.append('stream-text-'+key,ConversationItemKind.ASSISTANT,this.labels.streamingAssistant??'DeepSeek',e.text??'',date,out);
      else if(chunk==='reasoning-delta') this.append('stream-reason-'+key,ConversationItemKind.REASONING,this.labels.streamingReasoning??'Think',e.text??'',date,out);
      else if(chunk==='tool-call-delta') { const name=e.tool?.name??this.labels.assemblingTool??'Tool'; this.append('stream-tool-'+(e.tool?.id??key),name.toLowerCase()==='run_code'?ConversationItemKind.JSON_TOOL:ConversationItemKind.TOOL,name,e.tool?.argumentsDelta??'',date,out); }
      return;
    }
    if(e.type==='assistant/message') {
      this.finalizedKeys.add(key);
      if(e.reasoning!==undefined && e.reasoning.length>0) this.finalize('stream-reason-'+key,{id:id+'-reason',kind:ConversationItemKind.REASONING,title:this.labels.finalReasoning??'Think',text:e.reasoning,isError:e.interrupted,epochSeconds:date,turn:e.turn},out);
      if((e.text??'').length>0 || (e.images?.length??0)>0) this.finalizeAssistantText('stream-text-'+key,{id,kind:ConversationItemKind.ASSISTANT,title:e.interrupted===true?(this.labels.interrupted??'Generation interrupted'):(this.labels.finalAssistant??'DeepSeek'),text:e.text??'',images:e.images as Object[]|undefined,isError:e.interrupted,epochSeconds:date,turn:e.turn},out);
      return;
    }
    if (e.type === 'workspace/changes') {
      Logger.info('[CHANGES] event seq=' + record.seq + ' valid=' + (e.valid === false ? 'false' : 'true')
        + ' turn=' + (e.turn ?? -1));
      if (e.valid === false) return;
      this.upsertFilesItem(id, ConversationItemKind.CHANGES, e.turn, date, out, []);
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
      this.upsertFilesItem(id, ConversationItemKind.FILES, e.turn, date, out, files);
      return;
    }
    if(e.type==='tool/call') {
      const name=e.name??'Tool';
      const argsText=ConversationProjector.argumentsText(e.arguments);
      const callId=e.callId??'';
      const item:ConversationItem={id,kind:name.toLowerCase()==='run_code'?ConversationItemKind.JSON_TOOL:ConversationItemKind.TOOL,title:name,text:argsText,epochSeconds:date,turn:e.turn,callId:callId,argumentsText:argsText,status:'running',depth:0};
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
      this.insert({id,kind:ConversationItemKind.TOOL_RESULT,title:e.isError===true?(this.labels.toolResultFailed??'Tool failed'):(this.labels.toolResultDone??'Tool result'),text:preview,isError:e.isError,epochSeconds:date,turn:e.turn,callId:callId},out);
      if (e.appendOrigin === true && (e.mutationPath ?? '').length > 0 && (e.turn ?? 0) > 0) {
        const mutationPath: string = e.mutationPath as string;
        this.upsertFilesItem(id, ConversationItemKind.CHANGES, e.turn, date, out,
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
      const item:ConversationItem={id,kind:name.toLowerCase()==='run_code'?ConversationItemKind.JSON_TOOL:ConversationItemKind.TOOL,title:name,text:argsText,epochSeconds:date,turn:e.turn,callId:subCallId,parentCallId:parentCallId,rootCallId:rootCallId,subCallId:subCallId,depth:depth,argumentsText:argsText,status:start?'running':(e.isError===true?'error':'done'),resultText:preview};
      if(subCallId.length>0){this.toolItemIds.set(subCallId,id);this.toolDepths.set(subCallId,depth);}
      this.insert(item,out); return;
    }
    if(e.type==='turn/end') { const reason=e.reason??''; const title=reason==='error'||reason==='failed'?(this.labels.generationFailed??'Generation failed'):(['aborted','cancelled','canceled'].indexOf(reason)>=0?(this.labels.generationCancelled??'Generation cancelled'):reason==='interrupted'?(this.labels.interrupted??'Generation interrupted'):''); if(title.length>0) this.insert({id,kind:ConversationItemKind.SYSTEM,title,text:e.error??'',isError:reason==='error'||reason==='failed'||reason==='interrupted',epochSeconds:date,turn:e.turn},out); }
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
      this.insert({ id: id, kind: ConversationItemKind.STATUS, title: this.compactedHistoryText(items, tokens), text: '', epochSeconds: date, turn: e.turn }, out);
    }
    if (e.type === 'model/attempt-failed') this.insert({ id: id, kind: ConversationItemKind.STATUS, title: this.label('modelAttemptFailed', 'Model request failed'), text: e.error ?? '', isError: true, epochSeconds: date, turn: e.turn }, out);
    if (e.type === 'model/retrying') this.insert({ id: id, kind: ConversationItemKind.STATUS, title: this.label('modelRetrying', 'Retrying model request'), text: '', epochSeconds: date, turn: e.turn }, out);
    if (e.type === 'model/retried') this.insert({ id: id, kind: ConversationItemKind.STATUS, title: this.label('modelRetried', 'Model request retried'), text: '', epochSeconds: date, turn: e.turn }, out);
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
