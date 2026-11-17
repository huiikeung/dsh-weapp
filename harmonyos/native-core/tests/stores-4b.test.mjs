import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const load = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/import[\s\S]*?from[^;]*;/g,'').replace(/export\s+(type\s*)?\{[^}]*\};?/g,'').replace(/export /g,'');
const files = [
 '../src/main/ets/facade/SharedMviEvents.ets','../src/main/ets/stores/SharedStoreKernel.ets',
 '../src/main/ets/stores/SharedConversationStore.ets','../src/main/ets/stores/SharedHistoryStore.ets',
 '../src/main/ets/stores/SharedQuestionStore.ets','../src/main/ets/stores/SharedApprovalStore.ets',
 '../src/main/ets/stores/SharedQueueStore.ets','../src/main/ets/stores/SharedSessionListStore.ets',
 '../src/main/ets/stores/SharedTrajectoryStore.ets','../src/main/ets/stores/SharedSessionControlStore.ets',
 '../src/main/ets/stores/SharedTurnTimingStore.ets','../src/main/ets/stores/SharedVoiceInputStore.ets',
 '../src/main/ets/stores/SharedSlashCommandStore.ets','../src/main/ets/stores/SharedTeamStore.ets',
 '../src/main/ets/stores/SharedFileUploadStore.ets','../src/main/ets/stores/SharedWorkspaceFileStore.ets',
 '../src/main/ets/stores/SharedSessionAgentPresetStore.ets','../src/main/ets/stores/SharedMobileStore.ets'
];
const context={Map,Set,Object,JSON,Number,Math,String,Array,Error,Date,Promise};
runInNewContext(files.map(x=>stripTypeScriptTypes(load(x),{mode:'transform'})).join(';')+';globalThis.api={SharedApprovalStore,SharedQueueStore,SharedSessionListStore,SharedTrajectoryStore,SharedSessionControlStore,SharedTurnTimingStore,SharedVoiceInputStore,SharedSlashCommandStore,SharedTeamStore,SharedFileUploadStore,SharedWorkspaceFileStore,SharedSessionAgentPresetStore,SharedMobileStore};',context);
const a=context.api;
test('approval and queue stores enforce RPC and busy semantics',()=>{
  const approval=new a.SharedApprovalStore();const req={rpcId:'a1',sessionId:'s1',approvalId:'x',toolName:'shell'};
  assert.equal(approval.submitDecision('missing','allowed-once',true).errorCode,'UNKNOWN_RPC_ID');
  approval.requestReceived(req);
  assert.equal(approval.submitDecision('a1','bad',true).errorCode,'INVALID_OUTCOME');
  const r=approval.submitDecision('a1','allowed-once',true);assert.match(r.effect,/send-approval-response/);
  approval.responseReceived('a1',true);approval.resolved('a1');
  assert.equal(approval.submitDecision('a1','allowed-once',true).errorCode,'UNKNOWN_RPC_ID');
  const q=new a.SharedQueueStore();assert.ok(q.beginAction('s','i','steer').request);
  assert.equal(q.beginAction('s','i','remove').errorCode,'QUEUE_BUSY');
  q.acceptFrame(true);assert.ok(q.beginAction('s','i','remove').request);
});
test('session control, trajectory, session list and turn timing snapshots',()=>{
  const c=new a.SharedSessionControlStore();assert.equal(c.requestModels('s',false).errorCode,'NOT_CONNECTED');
  assert.match(c.selectModel('s',{provider:'p'},true).request,/select-model/);
  const t=new a.SharedTrajectoryStore();t.receiveEvents('s',[{seq:1}]);assert.equal(t.snapshot('s').length,1);t.clearSession('s');assert.equal(t.snapshot('s').length,0);
  const l=new a.SharedSessionListStore();l.receiveRemoteSessions([{id:'s',title:'t',running:false,unread:false,updatedAt:1}]);assert.equal(l.snapshot().length,1);
  const timing=new a.SharedTurnTimingStore();timing.awaitStart('s',0);timing.receiveLiveEvent('s',1000);assert.ok(timing.snapshot('s').elapsedSeconds>=0);
});
test('voice input, slash command, team, upload, workspace file and preset effects',()=>{
  const v=new a.SharedVoiceInputStore();v.open('chat','draft');assert.equal(v.permissionResult(false).errorCode,'PERMISSION_DENIED');
  v.open('chat','draft');assert.match(v.permissionResult(true).effect,/start-capture/);v.level(.4);v.pointerMoved(120);
  assert.match(v.release().effect,/cancel-capture/);assert.match(v.captureFinished('hello',true).effect,/show-transcript-confirmation/);
  const s=new a.SharedSlashCommandStore();s.updateInput('/model');assert.ok(s.commandExecutionForInput('/model x'));
  const team=new a.SharedTeamStore();assert.equal(team.restoreRoutingJson('[{"sessionId":"c","parentSessionId":"p"}]'),true);assert.equal(team.isChild('c'),true);
  const u=new a.SharedFileUploadStore();u.bind('s','k',true);u.add('f','a.txt',10,'sha');assert.equal(u.canSend(),false);u.acceptFrame('f','r1');assert.equal(JSON.stringify(u.receipts()),'["r1"]');
  const w=new a.SharedWorkspaceFileStore();assert.match(w.load('s','/','req1').request,/file-list/);w.acceptFrame([{name:'a'}]);assert.match(w.snapshot(),/a/);
  const p=new a.SharedSessionAgentPresetStore();assert.equal(p.open('s',false,true).errorCode,'PRESET_UNSUPPORTED');assert.match(p.open('s',true,true).request,/session-agent-preset/);
});
test('SharedMobileStore exposes all 16 facade stores',()=>{
  const m=new a.SharedMobileStore();assert.equal(m.moduleSummary(),'SharedMobileStore: 16 facade stores');
  assert.ok(m.conversation&&m.history&&m.question&&m.approval&&m.queue&&m.sessionList&&m.trajectory&&m.sessionControl&&m.turnTiming&&m.voiceInput&&m.slashCommand&&m.team&&m.fileUpload&&m.workspaceFile&&m.agentPreset);
});
