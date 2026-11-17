import { SessionEvent } from '../protocol/GatewayDtos';
import { asRec, num, str } from '../protocol/GatewayFrameCodec';

export enum TrajectoryNodeKind { INPUT='INPUT', CONTEXT='CONTEXT', REQUEST='REQUEST', ASSISTANT='ASSISTANT', TOOL='TOOL', SUBTOOL='SUBTOOL' }
export interface RequestTokenUsage { uncachedInput: number; cachedInput: number; output: number; reasoning: number; }
export interface TrajectoryRequest { number: number; turn?: number; step?: number; provider?: string; model?: string; options?: Object; usage: RequestTokenUsage; cumulativeUsage: RequestTokenUsage; toolCalls: number; subtoolCalls: number; }
export interface TrajectoryTool { hierarchy: string; schema?: Object; arguments?: string; result?: string; error?: string; }
export interface TrajectoryTiming { startedAt: number; endedAt: number; durationMs: number; }
export interface TrajectoryNode {
  id:string; kind:TrajectoryNodeKind; title:string; subtitle:string;
  startSequence:number; endSequence:number; startEpochSeconds:number; endEpochSeconds:number;
  records:SessionEvent[]; request?:TrajectoryRequest; tool?:TrajectoryTool;
  timing?:TrajectoryTiming; schema?:Object; arguments?:string; result?:string; error?:string;
  usage?:RequestTokenUsage; cumulativeUsage?:RequestTokenUsage;
}
export interface TrajectoryOperation { kind:string; node?:TrajectoryNode; nodeId?:string; nodes?:TrajectoryNode[]; }
export class TrajectoryProjection {
  static make(source:SessionEvent[]):TrajectoryNode[] {
    const events=source.slice().sort((a:SessionEvent,b:SessionEvent)=>a.seq-b.seq); const nodes:TrajectoryNode[]=[];
    const callIndexes:Map<string,number>=new Map(); const subIndexes:Map<string,number>=new Map();
    const requests:Map<string,number>=new Map(); const assistants:Map<string,number>=new Map();
    let cumulative:RequestTokenUsage={uncachedInput:0,cachedInput:0,output:0,reasoning:0}; let requestNumber=0;
    const metadata=events.filter((r:SessionEvent)=>r.event.type==='request/header'||r.event.type==='request/context');
    let options:Object|undefined; let context:Object|undefined;
    for(const r of metadata){const raw=asRec(r.event.raw);if(raw===undefined)continue;if(r.event.type==='request/header'){const header=asRec(raw['header']);if(header!==undefined)options=asRec(header['config']);}else context=r.event.raw;}
    for(const r of events){
      const e=r.event; const turn=e.turn; const step=e.step; const key=(turn??-1)+'-'+(step??-1); const id=r.sessionId+'-'+r.seq; const time=TrajectoryProjection.epoch(r.time);
      if(e.type==='user/message'&&(e.source===undefined||e.source==='user')&&(e.text??'').length>0){nodes.push(TrajectoryProjection.node('input-'+id,TrajectoryNodeKind.INPUT,'User',e.text??'',r));continue;}
      if(e.type==='user/message'&&e.source!==undefined&&e.source!=='user'&&(e.text??'').length>0){nodes.push(TrajectoryProjection.node('context-'+id,TrajectoryNodeKind.CONTEXT,e.source,e.text??'',r));continue;}
      if(e.type==='assistant/chunk'&&(e.chunkType==='text-delta'||e.chunkType==='reasoning-delta')){
        const usage=TrajectoryProjection.usage(e.usage); let requestIndex=requests.get(key);
        if(requestIndex===undefined){requestNumber++;cumulative=TrajectoryProjection.add(cumulative,usage);requestIndex=nodes.length;requests.set(key,requestIndex);nodes.push({id:'request-'+key,kind:TrajectoryNodeKind.REQUEST,title:'Request #'+requestNumber,subtitle:TrajectoryProjection.subtitle(turn,step,context,options),startSequence:r.seq,endSequence:r.seq,startEpochSeconds:time,endEpochSeconds:time,records:metadata.concat([r]),request:{number:requestNumber,turn,step,provider:TrajectoryProjection.pick(context,options,'provider'),model:TrajectoryProjection.pick(context,options,'model'),options,usage,cumulativeUsage:TrajectoryProjection.cloneUsage(cumulative),toolCalls:0,subtoolCalls:0}});}
        let ai=assistants.get(key);if(ai===undefined){ai=nodes.length;assistants.set(key,ai);nodes.push(TrajectoryProjection.node('assistant-stream-'+key,TrajectoryNodeKind.ASSISTANT,'Assistant',e.text??'',r));}
        else {const old=nodes[ai];nodes[ai]=TrajectoryProjection.extend(old,e.text??'',r);}
        if(requestIndex!==undefined)nodes[requestIndex]=TrajectoryProjection.extend(nodes[requestIndex],'',r); continue;
      }
      if(e.type==='assistant/message'||e.type==='assistant/attempt'){
        const usage=TrajectoryProjection.usage(e.usage); let index=requests.get(key);
        if(index===undefined){requestNumber++;cumulative=TrajectoryProjection.add(cumulative,usage);index=nodes.length;requests.set(key,index);nodes.push({id:'request-'+key,kind:TrajectoryNodeKind.REQUEST,title:'Request #'+requestNumber,subtitle:TrajectoryProjection.subtitle(turn,step,context,options),startSequence:r.seq,endSequence:r.seq,startEpochSeconds:time,endEpochSeconds:time,records:metadata.concat([r]),request:{number:requestNumber,turn,step,provider:TrajectoryProjection.pick(context,options,'provider'),model:TrajectoryProjection.pick(context,options,'model'),options,usage,cumulativeUsage:TrajectoryProjection.cloneUsage(cumulative),toolCalls:e.toolCalls?.length??0,subtoolCalls:0}});}
        else {const old=nodes[index];const prior=old.request?.usage??TrajectoryProjection.zero();cumulative=TrajectoryProjection.add(tajectorySub(cumulative,prior),usage);nodes[index]={id:old.id,kind:old.kind,title:old.title,subtitle:TrajectoryProjection.subtitle(turn,step,context,options),startSequence:old.startSequence,endSequence:r.seq,startEpochSeconds:old.startEpochSeconds,endEpochSeconds:time,records:old.records.concat([r]),tool:old.tool,request:{number:old.request?.number??requestNumber,turn,step,provider:TrajectoryProjection.pick(context,options,'provider'),model:TrajectoryProjection.pick(context,options,'model'),options,usage,cumulativeUsage:TrajectoryProjection.cloneUsage(cumulative),toolCalls:e.toolCalls?.length??0,subtoolCalls:old.request?.subtoolCalls??0}};}
        const ai=assistants.get(key);if(ai!==undefined)nodes[ai]=TrajectoryProjection.extend(nodes[ai],e.reasoning??e.text??'(tool call only)',r);
        else nodes.push(TrajectoryProjection.node('assistant-'+id,TrajectoryNodeKind.ASSISTANT,'Assistant',e.reasoning??e.text??'(tool call only)',r)); continue;
      }
      if(e.type==='tool/call'){
        const call=e.callId??id;callIndexes.set(call,nodes.length);const node=TrajectoryProjection.node('tool-'+call,TrajectoryNodeKind.TOOL,(e.name??'tool').toLowerCase(),e.arguments===undefined?'':JSON.stringify(e.arguments).replace(/\n/g,' '),r);node.tool={hierarchy:'Assistant Message'};nodes.push(node);continue;
      }
      if(e.type==='tool/result'){
        const call=e.callId??id;const index=callIndexes.get(call);if(index===undefined)nodes.push(TrajectoryProjection.node('tool-result-'+id,TrajectoryNodeKind.TOOL,e.isError===true?'tool error':'tool result',e.preview??'',r));else nodes[index]=TrajectoryProjection.extend(nodes[index],e.preview??'',r);continue;
      }
      if(e.type==='tool/code-dispatch-start'){
        const call=e.subCallId??id;subIndexes.set(call,nodes.length);const parent=e.parentCallId!==undefined?callIndexes.get(e.parentCallId):undefined;const hierarchy=parent!==undefined?nodes[parent].title:'Tool';const node=TrajectoryProjection.node('subtool-'+call,TrajectoryNodeKind.SUBTOOL,(e.name??'subtool').toLowerCase(),e.arguments===undefined?'':JSON.stringify(e.arguments),r);node.tool={hierarchy};nodes.push(node);continue;
      }
      if(e.type==='tool/code-dispatch'){
        const call=e.subCallId??id;const index=subIndexes.get(call);if(index===undefined){const node=TrajectoryProjection.node('subtool-result-'+id,TrajectoryNodeKind.SUBTOOL,e.name??'subtool',e.preview??'',r);node.tool={hierarchy:'Tool'};nodes.push(node);}else nodes[index]=TrajectoryProjection.extend(nodes[index],e.preview??'',r);
      }
    }
    return nodes.sort((a:TrajectoryNode,b:TrajectoryNode)=>a.startSequence-b.startSequence||TrajectoryProjection.priority(a.kind)-TrajectoryProjection.priority(b.kind));
  }
  static node(id:string,kind:TrajectoryNodeKind,title:string,subtitle:string,r:SessionEvent):TrajectoryNode{
    const event = r.event as Object as Record<string, Object>;
    const timing:TrajectoryTiming = { startedAt:r.time, endedAt:r.time, durationMs:0 };
    const schema = event['schema'] as Object | undefined;
    const args = typeof event['arguments'] === 'string' ? event['arguments'] as string : undefined;
    const result = typeof event['outcome'] === 'string' ? event['outcome'] as string : undefined;
    const error = typeof event['error'] === 'string' ? event['error'] as string : undefined;
    const node:TrajectoryNode = { id, kind, title, subtitle, startSequence:r.seq, endSequence:r.seq, startEpochSeconds:TrajectoryProjection.epoch(r.time), endEpochSeconds:TrajectoryProjection.epoch(r.time), records:[r], timing, schema, arguments:args, result, error };
    return node;
  }
  static extend(old:TrajectoryNode,text:string,r:SessionEvent):TrajectoryNode {
    const timing:TrajectoryTiming = old.timing ?? { startedAt:r.time, endedAt:r.time, durationMs:0 };
    const updated:TrajectoryTiming = { startedAt:timing.startedAt, endedAt:r.time, durationMs:Math.max(0,r.time-timing.startedAt) };
    return {id:old.id,kind:old.kind,title:old.title,subtitle:text.length>0?old.subtitle+text:old.subtitle,startSequence:old.startSequence,endSequence:r.seq,startEpochSeconds:old.startEpochSeconds,endEpochSeconds:TrajectoryProjection.epoch(r.time),records:old.records.concat([r]),request:old.request,tool:old.tool,timing:updated,schema:old.schema,arguments:old.arguments,result:old.result,error:old.error,usage:old.usage,cumulativeUsage:old.cumulativeUsage};
  }
  static usage(value?:Object):RequestTokenUsage {return {uncachedInput:TrajectoryProjection.firstInt(value,['inputTokens','input_tokens','uncachedInputTokens']),cachedInput:TrajectoryProjection.firstInt(value,['cacheReadTokens','cachedInputTokens','cached_tokens']),output:TrajectoryProjection.firstInt(value,['outputTokens','output_tokens','completionTokens']),reasoning:TrajectoryProjection.firstInt(value,['reasoningTokens','reasoning_tokens'])};}
  static add(a:RequestTokenUsage,b:RequestTokenUsage):RequestTokenUsage{return {uncachedInput:a.uncachedInput+b.uncachedInput,cachedInput:a.cachedInput+b.cachedInput,output:a.output+b.output,reasoning:a.reasoning+b.reasoning};}
  static cloneUsage(u:RequestTokenUsage):RequestTokenUsage{return {uncachedInput:u.uncachedInput,cachedInput:u.cachedInput,output:u.output,reasoning:u.reasoning};}
  static zero():RequestTokenUsage{return {uncachedInput:0,cachedInput:0,output:0,reasoning:0};}
  private static firstInt(value:Object|undefined,keys:string[]):number {const rec=asRec(value);if(rec===undefined)return 0;for(const key of keys){const v=rec[key];if(typeof v==='number'&&Number.isFinite(v))return Math.max(0,Math.floor(v));}return 0;}
  private static pick(context:Object|undefined,options:Object|undefined,key:string):string|undefined{return str(context,key)??str(options,key);}
  private static subtitle(turn:number|undefined,step:number|undefined,context:Object|undefined,options:Object|undefined):string{return [turn!==undefined?'Turn '+turn:undefined,step!==undefined?'Step '+step:undefined,TrajectoryProjection.pick(context,options,'provider'),TrajectoryProjection.pick(context,options,'model')].filter((v:string|undefined)=>v!==undefined).join(' · ');}
  private static epoch(v:number):number{return v>10000000000?v/1000:v;}
  private static priority(kind:TrajectoryNodeKind):number{return kind==='INPUT'?0:kind==='CONTEXT'?1:kind==='REQUEST'?2:kind==='ASSISTANT'?3:kind==='TOOL'?4:5;}
}
function tajectorySub(a:RequestTokenUsage,b:RequestTokenUsage):RequestTokenUsage{return {uncachedInput:a.uncachedInput-b.uncachedInput,cachedInput:a.cachedInput-b.cachedInput,output:a.output-b.output,reasoning:a.reasoning-b.reasoning};}
export class TrajectoryProjector {
  private records:Map<number,SessionEvent>=new Map(); private nodes:TrajectoryNode[]=[];
  fold(record:SessionEvent):TrajectoryOperation[] {
    if(!Number.isSafeInteger(record.seq)||record.seq<0)return [];
    const previous=this.records.get(record.seq);if(previous!==undefined&&JSON.stringify(previous)===JSON.stringify(record))return [];
    const outOfOrder=record.seq<=this.lastSequence||previous!==undefined;this.records.set(record.seq,record);
    const next=TrajectoryProjection.make(Array.from(this.records.values()));
    if(outOfOrder){this.nodes=next;return [{kind:'replaceAll',nodes:next.slice()}];}
    const oldById=new Map<string,TrajectoryNode>();for(const n of this.nodes)oldById.set(n.id,n);
    const ops:TrajectoryOperation[]=[];for(const n of next){const old=oldById.get(n.id);if(old===undefined)ops.push({kind:'insert',node:n});else if(JSON.stringify(old)!==JSON.stringify(n))ops.push({kind:'replace',node:n,nodeId:n.id});}
    this.nodes=next;return ops;
  }
  get items():TrajectoryNode[]{return this.nodes.slice();}
  get lastSequence():number {let max=-1;for(const seq of this.records.keys())if(seq>max)max=seq;return max;}
  reset():void{this.records.clear();this.nodes=[];}
}
