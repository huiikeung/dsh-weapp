import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const load=p=>{
 let source=readFileSync(new URL('../src/main/ets/'+p,import.meta.url),'utf8');
 source=source.replace("export enum ConversationItemKind { USER='USER', CONTEXT='CONTEXT', ASSISTANT='ASSISTANT', REASONING='REASONING', TOOL='TOOL', JSON_TOOL='JSON_TOOL', TOOL_RESULT='TOOL_RESULT', GENERATED_IMAGES='GENERATED_IMAGES', STATUS='STATUS', SYSTEM='SYSTEM' }", "const ConversationItemKind={USER:'USER',CONTEXT:'CONTEXT',ASSISTANT:'ASSISTANT',REASONING:'REASONING',TOOL:'TOOL',JSON_TOOL:'JSON_TOOL',TOOL_RESULT:'TOOL_RESULT',GENERATED_IMAGES:'GENERATED_IMAGES',STATUS:'STATUS',SYSTEM:'SYSTEM'};");
 source=source.replace("export enum TrajectoryNodeKind { INPUT='INPUT', CONTEXT='CONTEXT', REQUEST='REQUEST', ASSISTANT='ASSISTANT', TOOL='TOOL', SUBTOOL='SUBTOOL' }", "const TrajectoryNodeKind={INPUT:'INPUT',CONTEXT:'CONTEXT',REQUEST:'REQUEST',ASSISTANT:'ASSISTANT',TOOL:'TOOL',SUBTOOL:'SUBTOOL'};");
 return source.replace(/^import[\s\S]*?;$/gm,'').replace(/export /g,'');
};
const ctx={Map,Set,Object,Array,JSON,Number,Math,Date,Error,Promise,setTimeout,clearTimeout,asRec:v=>v&&typeof v==='object'?v:undefined,str:(v,k)=>typeof v?.[k]==='string'?v[k]:undefined,num:(v,k)=>typeof v?.[k]==='number'?v[k]:undefined};
const files=[['sync/HistoryReducer.ets','HistoryReducer, HistoryEventMerger'],['sync/HistorySyncEngine.ets','HistorySyncEngine'],['sync/AssistantStreamState.ets','AssistantStreamState'],['projection/ConversationProjection.ets','ConversationProjector, ConversationItemKind'],['projection/TrajectoryProjection.ets','TrajectoryProjector, TrajectoryProjection'],['projection/ToolActivitySummary.ets','ToolActivitySummaryFormatter']];
for(const [file,names] of files)runInNewContext(stripTypeScriptTypes(load(file))+';globalThis.api={...(globalThis.api||{}),'+names.split(', ').map(n=>n+':'+n).join(',')+'};',ctx);
const {HistoryReducer:H,HistoryEventMerger:M,HistorySyncEngine:E,AssistantStreamState:S,ConversationProjector:C,TrajectoryProjector:T,TrajectoryProjection:TP,ToolActivitySummaryFormatter:F}=ctx.api;
const event=(sessionId,seq,type,fields={})=>({sessionId,seq,time:1700000000000+seq,event:{type,...fields}});
test('history paging batches two pages and rejects missing or repeated cursor',()=>{
 let state=H.initial();let r=H.reduce(state,{kind:'Start',sessionId:'s',older:false,hasLocalEvents:true});state=r.state;assert.equal(r.result.kind,'RequestPage');
 r=H.reduce(state,{kind:'PageCommitted',sessionId:'s',eventCount:3,byteCount:10,hasMore:true,nextBeforeSequence:20});state=r.state;assert.equal(r.result.beforeSequence,20);
 r=H.reduce(state,{kind:'PageCommitted',sessionId:'s',eventCount:2,byteCount:8,hasMore:true,nextBeforeSequence:10});assert.equal(r.result.kind,'Completed');
 state=r.state;r=H.reduce(state,{kind:'Start',sessionId:'s',older:true,earliestLocalSequence:10});state=r.state;
 r=H.reduce(state,{kind:'PageCommitted',sessionId:'s',eventCount:1,byteCount:1,hasMore:true,nextBeforeSequence:10});assert.equal(r.result.code,'REPEATED_CURSOR');assert.equal(r.state.sessions.get('s').hasMore,false);
});
test('history event merge replaces duplicate sequence and sorts live tail',()=>{
 let rows=[event('s',1,'user/message',{text:'a'}),event('s',3,'turn/end')];let merged=M.merge(event('s',2,'turn/start'),rows);assert.deepEqual(merged.events.map(x=>x.seq),[1,2,3]);assert.equal(merged.replacedOrInsertedOutOfOrder,true);
 merged=M.merge(event('s',2,'user/message',{text:'replacement'}),merged.events);assert.equal(merged.events.length,3);assert.equal(merged.events[1].event.text,'replacement');
 const page=M.mergePage(merged.events,[event('s',0,'user/message'),event('s',2,'user/message',{text:'page'})]);assert.deepEqual(page.map(x=>x.seq),[0,1,2,3]);assert.equal(page[2].event.text,'page');
});
test('history engine ignores stale generation timeout and cancels per session',async()=>{
 const engine=new E();let expired=0;const a=engine.beginRequest('s',30,()=>expired++);const b=engine.beginRequest('s',100,()=>expired++);assert.equal(engine.isCurrent(a,'s'),false);assert.equal(engine.isCurrent(b,'s'),true);engine.finish('s');await new Promise(r=>setTimeout(r,120));assert.equal(expired,0);engine.close();
});
test('conversation projection emits inserts then stream deltas and final replacement; duplicates no-op',()=>{
 const p=new C();const operations=[];operations.push(...p.fold(event('s',1,'user/message',{text:'hello'})));
 operations.push(...p.fold(event('s',2,'assistant/chunk',{turn:1,step:1,chunkType:'text-delta',text:'hel'})));
 operations.push(...p.fold(event('s',3,'assistant/chunk',{turn:1,step:1,chunkType:'text-delta',text:'lo'})));
 assert.equal(operations[2].kind,'append');assert.equal(p.items[1].text,'hello');assert.equal(p.lastSequence,3);
 assert.equal(p.fold(event('s',3,'assistant/chunk',{turn:1,step:1,chunkType:'text-delta',text:'lo'})).length,0);
 const final=p.fold(event('s',4,'assistant/message',{turn:1,step:1,text:'hello world'}));assert.equal(final[0].kind,'replace');assert.equal(p.items[1].text,'hello world');
 const old=p.fold(event('s',2,'assistant/chunk',{turn:1,step:1,chunkType:'text-delta',text:'HE'}));assert.equal(old[0].kind,'replaceAll');assert.equal(p.lastSequence,4);
});
test('trajectory projection merges tool result by call id and cumulative token usage',()=>{
 const rows=[event('s',1,'user/message',{text:'hi'}),event('s',2,'assistant/chunk',{turn:1,step:1,chunkType:'text-delta',text:'a',usage:{inputTokens:4,outputTokens:2}}),event('s',3,'tool/call',{turn:1,step:1,callId:'c',name:'bash',arguments:{command:'ls'}}),event('s',4,'tool/result',{turn:1,step:1,callId:'c',preview:'ok'}),event('s',5,'assistant/message',{turn:1,step:1,text:'done',usage:{inputTokens:4,outputTokens:3}})];
 const nodes=TP.make(rows);const tool=nodes.find(n=>n.id==='tool-c');assert.ok(tool.subtitle.includes('ok'));const req=nodes.find(n=>n.kind==='REQUEST');assert.equal(req.request.usage.output,3);assert.equal(req.request.cumulativeUsage.output,3);
 const projector=new T();assert.equal(projector.fold(rows[0]).length,1);assert.equal(projector.fold(rows[0]).length,0);const patch=projector.fold(rows[1]);assert.ok(patch.length>0);assert.equal(projector.items.length,3);
});
test('tool summaries use protocol labels and annotations',()=>{
 const summary=F.summarize('write',JSON.stringify({path:'a.txt',content:'a\nb\n'}));assert.equal(summary.label,'写入');assert.equal(summary.detail,'a.txt');assert.equal(summary.annotation,'2 行');
});
test('assistant stream requires subscription baseline and monotonic revision/index/cursor',()=>{
 const s=new S();s.selectSession('s');assert.equal(s.accept({kind:'subscribed',sessionId:'s',subscriptionId:'sub'}).accepted,true);
 const base=s.accept({kind:'session-snapshot',sessionId:'s',subscriptionId:'sub',streamId:'st',cursor:4,historyFormatVersion:1,assistantStream:{revision:0}});assert.equal(base.accepted,true);assert.equal(s.persistentCursor,4);
 const chunk={kind:'assistant-stream',sessionId:'s',subscriptionId:'sub',streamId:'st',frame:{type:'start',revision:1,attemptId:'a',turn:2,step:1}};assert.equal(s.accept(chunk).accepted,true);
 const c={kind:'assistant-stream',sessionId:'s',subscriptionId:'sub',streamId:'st',frame:{type:'chunk',revision:2,attemptId:'a',index:0,time:1,chunk:{type:'text-delta',text:'x'}}};assert.equal(s.accept(c).chunks.length,1);assert.equal(s.accept(c).accepted,false);
 const gap={kind:'assistant-stream',sessionId:'s',subscriptionId:'sub',streamId:'st',frame:{type:'chunk',revision:4,attemptId:'a',index:1,chunk:{type:'text-delta',text:'y'}}};assert.equal(s.accept(gap).resubscribe,true);
});
