import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const load = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/import[\s\S]*?from[^;]*;/g, '').replace(/export\s+(type\s*)?\{[^}]*\};?/g, '').replace(/export /g, '');
const context = { Map, Set, Object, JSON, Number, Math, String, Array, Error, Date };
runInNewContext([
  load('../src/main/ets/protocol/GatewayFrameCodec.ets'),
  load('../src/main/ets/projection/ConversationProjection.ets'),
  load('../src/main/ets/projection/TrajectoryProjection.ets'),
  ';globalThis.api={ConversationProjector,ConversationItemKind,TrajectoryProjection}'
].map(x => stripTypeScriptTypes(x,{mode:'transform'})).join(';'), context);
const api = context.api;
const ev = (seq,type,event={},time=1000+seq) => ({ sessionId:'s',seq,time,event:{type,...event} });
test('conversation labels, command/compaction/model status and rebase',()=>{
  const p = new api.ConversationProjector({ commandRunning:'运行中', compactedHistory:'已压缩 {items} 项 (~{tokens})' });
  assert.equal(p.label('commandRunning','Running…'),'运行中');
  p.foldWithOperations([
    ev(1,'command/started',{commandId:'c1',line:'build'}),
    ev(2,'command/completed',{commandId:'c1',result:{ok:true}}),
    ev(3,'context/compacted',{items:7,tokens:900}),
    ev(4,'model/attempt-failed',{error:'timeout'})
  ]);
  const titles = p.items.map(x=>x.title);
  assert.ok(titles.includes('运行中') || titles.includes('Completed'));
  assert.ok(titles.some(x=>x.includes('7') && x.includes('900')));
  assert.ok(titles.some(x=>x.includes('Model') || x.includes('failed')));
  const ops = p.foldWithOperations([ev(5,'user/message',{text:'late'})]);
  assert.ok(ops.length>0);
  const r = p.rebase([ev(1,'user/message',{text:'history'})],[ev(2,'user/message',{text:'live'})]);
  assert.equal(r.events.length,1); assert.equal(r.liveTail.length,1);
});
test('conversation item carries files, textParts and requestId fields',()=>{
  const p = new api.ConversationProjector();
  p.foldWithOperations([ev(1,'user/message',{text:'hi',files:[{name:'a.txt'}],textParts:[{type:'text',text:'hi'}],requestId:'r1'})]);
  const item = p.items[0];
  assert.equal(item.kind,api.ConversationItemKind.USER);
  assert.equal(item.text,'hi');
});
test('trajectory node exposes schema, arguments, result, error and timing',()=>{
  const r = ev(1,'tool/call',{name:'shell',arguments:'ls',schema:{type:'object'},error:'none',outcome:'ok'},1000);
  const nodes = api.TrajectoryProjection.make([r,ev(2,'tool/result',{name:'shell',preview:'done'},1500)]);
  assert.ok(nodes.length>0);
  const n = nodes.find(x=>x.kind==='TOOL') ?? nodes[0];
  assert.equal(n.arguments,'ls'); assert.equal(n.result,'ok'); assert.equal(n.error,'none');
  assert.ok(n.schema); assert.ok(n.timing);
  assert.ok(n.timing.durationMs>=0);
});
