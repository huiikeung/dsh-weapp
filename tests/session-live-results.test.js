const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
  const file=path.resolve(__dirname,'../miniprogram/utils/store.js'),module={exports:{}},timers=new Map(),requests=[];let serial=0;
  class Client{constructor(callbacks){this.callbacks=callbacks;this.connectGeneration=1;}requestHistory(id){requests.push(id);return true;}}
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,Date,console,wx:{getStorageSync(){},setStorageSync(){},removeStorageSync(){}},
    setTimeout(fn,delay){timers.set(++serial,{fn,delay});return serial;},clearTimeout(id){timers.delete(id);},setInterval(){return 0;},clearInterval(){},
    require(name){return name==='./gateway'?{GatewayClient:Client}:require(path.resolve(path.dirname(file),name));}});
  const store=module.exports;store.sessionState.sessionId='s';store.state.connection='connected';
  return {store,requests,timers,frame:frame=>store.client.callbacks.onFrame({sessionId:'s',...frame}),flush(){for(const [id,t]of [...timers])if(t.delay===80){timers.delete(id);t.fn();}}};
}
const fileEvent={seq:3,type:'deliverables/presented',data:{turn:1,callId:'present-1',files:[{path:'result.pdf',description:'Final report'}]}};
test('complete live file declarations render without history or reopening the session',()=>{
  for(const nested of [false,true]){const f=fixture();let last=[];f.store.subscribe(s=>last=s.session.rows);
    f.frame({kind:'event',seq:3,event:nested?fileEvent:{type:fileEvent.type,...fileEvent.data}});
    assert.equal(last[0].kind,'files');assert.equal(last[0].files[0].path,'result.pdf');f.flush();assert.equal(f.requests.length,0);
  }
});
test('legacy type-only file events coalesce a scoped history refresh and publish the missing cards',()=>{
  const f=fixture();let last=[];f.store.subscribe(s=>last=s.session.rows);
  f.frame({kind:'event',seq:3,event:{type:'deliverables/presented'}});
  f.frame({kind:'event',seq:4,event:{type:'workspace/changes'}});
  f.flush();assert.deepEqual(f.requests,['s']);
  f.frame({kind:'history',events:[fileEvent,{seq:4,type:'workspace/changes',data:{turn:1}}]});
  assert.equal(last.filter(r=>r.kind==='files').length,1);assert.equal(last.find(r=>r.kind==='files').files[0].path,'result.pdf');
  assert.equal(last.find(r=>r.kind==='changes').changeSeq,4);
  f.frame({kind:'event',seq:3,event:fileEvent});assert.equal(last.filter(r=>r.kind==='files').length,1);
});
test('deferred file refresh cannot leak across sessions, transports or offline state',()=>{
  for(const mode of ['session','transport','offline']){const f=fixture();f.frame({kind:'event',seq:3,event:{type:'deliverables/presented'}});
    if(mode==='session')f.store.sessionState.sessionId='other';if(mode==='transport')f.store.client.connectGeneration++;if(mode==='offline')f.store.state.connection='disconnected';
    f.flush();assert.equal(f.requests.length,0,mode);
  }
});
test('replacement tool results keep their surface metadata rather than inventing edited files',()=>{
  const f=fixture();
  f.frame({kind:'event',seq:1,event:{type:'tool/call',turn:1,callId:'c',name:'write',arguments:{file_path:'a.txt',content:'new'}}});
  f.frame({kind:'event',seq:2,surfaceOp:'replace',event:{type:'tool/result',turn:1,callId:'c',preview:'ok'}});
  assert.ok(!f.store.sessionState.rows.some(r=>r.kind==='changes'));
});
