import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const load = p => readFileSync(new URL(p, import.meta.url),'utf8').replace(/import[\s\S]*?from[^;]*;/g,'').replace(/export\s+(type\s*)?\{[^}]*\};?/g,'').replace(/export /g,'');
const files=['../src/main/ets/cache/ChatCacheWindowPolicy.ets','../src/main/ets/cache/ChatMemoryCache.ets','../src/main/ets/cache/ChatCacheDiagnostics.ets','../src/main/ets/cache/ChatPrefetchPolicy.ets','../src/main/ets/cache/SharedChatHistoryCache.ets','../src/main/ets/transport/GatewayTransportPolicy.ets','../src/main/ets/transport/MgwCodec.ets','../src/main/ets/transport/RtcUpgradeMachine.ets','../src/main/ets/transport/RtcDiagnostics.ets','../src/main/ets/transport/RtcSelectedPath.ets','../src/main/ets/tailscale/TailscalePlatformStatus.ets','../src/main/ets/diagnostics/NetworkDiagnosticsStore.ets'];
const ctx={Map,Set,Object,JSON,Number,Math,String,Array,Error,Date};
runInNewContext(files.map(x=>stripTypeScriptTypes(load(x),{mode:'transform'})).join(';')+';globalThis.api={ChatCacheWindowPolicy,ChatMemoryCache,ChatCacheDiagnostics,ChatPrefetchPolicy,SharedChatHistoryCache,GatewayTransportPolicy,MgwCodec,RtcUpgradeMachine,RtcDiagnostics,RtcPathInspector,TailscalePlatformStatus,TailscaleStage,NetworkDiagnosticsStore};',ctx);
const a=ctx.api;
test('chat memory cache and window policy',()=>{
  const c=new a.ChatMemoryCache();const k={gatewayId:'g',sessionId:'s'};
  assert.equal(c.get(k),undefined);c.put(k,{sessionId:'s',events:[],cursor:0,hasMore:false,bytes:10});
  assert.ok(c.get(k));assert.equal(c.size,1);c.clear('g');assert.equal(c.size,0);
  assert.equal(a.ChatCacheWindowPolicy.shouldPersist(10),true);
  assert.equal(a.ChatCacheWindowPolicy.trim([1,2,3],1).length,3);
});
test('prefetch ranking and cache diagnostics',()=>{
  const ids=a.ChatPrefetchPolicy.rank([{id:'a',lastActivityEpochSeconds:1000,isRunning:true,hasUnread:true,hasConversation:true},{id:'b',lastActivityEpochSeconds:1000,isRunning:false,hasUnread:false,hasConversation:true}],1000,1);
  assert.equal(ids[0],'a');assert.equal(a.ChatPrefetchPolicy.validIdentifier(''),false);
  const d=new a.ChatCacheDiagnostics();d.databaseUnavailable();d.restoreSkipped('FORMAT_CHANGED');assert.match(d.snapshot(),/FORMAT_CHANGED/);
});
test('RTC transport policy, upgrade machine, codec and path inspector',()=>{
  assert.equal(a.GatewayTransportPolicy.allowsRtc('wss://host/ws'),true);
  assert.equal(a.GatewayTransportPolicy.allowsRtc('ws://host/ws'),false);
  const m=new a.RtcUpgradeMachine();assert.equal(m.start('data').kind,'offer');m.accepted();assert.equal(m.isReady,true);m.timeout();assert.equal(m.isReady,true);
  const codec=new a.MgwCodec();const wire=codec.encode('control','hello');assert.equal(codec.receive(wire+'\n').payload,'hello');
  assert.ok(a.RtcPathInspector.inspect('{"kind":"direct","protocol":"udp"}'));
  assert.match(a.RtcDiagnostics.message('failed','timeout'),/supported":false/);
});
test('HarmonyOS platform: Tailscale unsupported, network diagnostics available',()=>{
  const s=a.TailscalePlatformStatus.snapshot();assert.equal(s.supported,false);assert.equal(s.stage,a.TailscaleStage.UNSUPPORTED);
  const n=new a.NetworkDiagnosticsStore();n.start();n.add({elapsedSeconds:1,roundTripMs:10,jitterMs:1,lossPercent:0,receivedBytesPerSecond:1,sentBytesPerSecond:1,segment:0});
  assert.equal(n.snapshot().samples.length,1);n.stop();assert.equal(n.snapshot().active,false);
});
test('shared chat history cache reports stats',()=>{
  const cache=new a.SharedChatHistoryCache();cache.put({gatewayId:'g',sessionId:'s'},{sessionId:'s',events:[],cursor:0,hasMore:false,bytes:1});
  assert.equal(cache.stats().sessionCount,1);cache.clear();assert.equal(cache.stats().sessionCount,0);
});
