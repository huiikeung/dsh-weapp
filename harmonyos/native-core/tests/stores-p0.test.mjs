import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const load = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/^import[\s\S]*?;$/gm, '').replace(/export /g, '');
const context = { Map, Object, JSON, Number, Error, String, Array };
runInNewContext([load('../src/main/ets/facade/SharedMviEvents.ets'),load('../src/main/ets/stores/SharedStoreKernel.ets'),load('../src/main/ets/stores/SharedConversationStore.ets'),load('../src/main/ets/stores/SharedHistoryStore.ets'),load('../src/main/ets/stores/SharedQuestionStore.ets'),';globalThis.api={SharedConversationStore,SharedHistoryStore,SharedQuestionStore}'].map(x=>stripTypeScriptTypes(x,{mode:'transform'})).join(';'),context);
const api=context.api;
test('conversation store replaces then clears a projection with MVI transitions',()=>{
  const s=new api.SharedConversationStore(); const seen=[]; s.subscribe(e=>seen.push(e));
  assert.equal(s.hasProjection('s'),false); s.replaceSession('s',[{text:'one'}]);
  assert.equal(s.hasProjection('s'),true); assert.equal(s.snapshot('s').length,1);
  s.clearSessionProjection('s'); assert.equal(s.hasProjection('s'),false); assert.ok(seen.length>=3);
});
test('history store validates cursor and appends live events',()=>{
  const s=new api.SharedHistoryStore(); assert.equal(s.replacePage('s',[],-1,false).accepted,false);
  assert.equal(s.replacePage('s',[{seq:1}],0,true).accepted,true); s.appendLive('s',{seq:2});
  assert.equal(s.state('s').events.length,2); assert.equal(s.state('s').hasMore,true);
});
test('question store isolates RPCs and emits answer/cancel effects',()=>{
  const s=new api.SharedQuestionStore(); const q={rpcId:'q1',sessionId:'s1',questions:[],replay:false};
  assert.equal(s.submitAnswer('missing',[],true).errorCode,'UNKNOWN_RPC_ID');
  assert.equal(s.requestReceived(q).errorCode,null);
  assert.equal(s.submitAnswer('q1',[],true).errorCode,'EMPTY_ANSWERS');
  const answer=s.submitAnswer('q1',[{id:'1',selected:['A']}],true);
  assert.equal(answer.errorCode,null); assert.match(answer.effectJson,/send-question-answer/);
  assert.equal(s.submitCancel('q1',false).errorCode,'NOT_CONNECTED');
  s.responseReceived('q1',true); s.resolved('q1');
  assert.equal(s.submitAnswer('q1',[{id:'1',selected:[]}],true).errorCode,'UNKNOWN_RPC_ID');
});
