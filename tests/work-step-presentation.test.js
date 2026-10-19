const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../miniprogram/utils/work-step-presentation');
const protocol=require('../miniprogram/utils/protocol');
const {buildEntries}=require('../miniprogram/utils/conversation-workflow');
const group=(extra)=>({kind:'processGroup',key:'g',running:true,completed:false,children:[],...extra});
test('four desktop modes have distinct live disclosure and detail policies',()=>{
 for(const mode of ['compact','standard','detailed','verbose']){
  const rows=[group({activityDetail:'Inspect repository'})],folds=policy.apply(rows,{mode}, {}, [],true);
  assert.equal(folds.g,['detailed','verbose'].includes(mode));
  assert.equal(rows[0].liveDetail,['standard','detailed'].includes(mode)?'Inspect repository':'');
  assert.equal(rows[0].compactReasoning,mode==='compact');
 }
});
test('completion collapse and next-input collapse are independent',()=>{
 const running=[group()],done=[group({running:false,completed:true})];
 assert.equal(policy.apply(done,{mode:'detailed',timing:'completion'},{g:true},running,false).g,false);
 const pending=[group({running:false,completed:true})];
 assert.equal(policy.apply(pending,{mode:'detailed',timing:'next-input'},{g:true},running,false).g,true);
 const next=[group({running:false,completed:true}),{kind:'user',key:'u'}];
 assert.equal(policy.apply(next,{mode:'detailed',timing:'next-input'},{g:true},pending,false).g,false);
 assert.equal(policy.apply(next,{mode:'verbose',timing:'completion'},{g:true},running,false).g,true);
});
test('manual disclosure survives ticks and reopening a completed turn',()=>{
 assert.equal(policy.apply([group()],{mode:'detailed'},{g:false},[group()],false).g,false);
 const done=()=>group({running:false,completed:true});
 assert.equal(policy.apply([done()],{mode:'detailed'},{g:true},[done()],false).g,true);
 assert.equal(policy.apply([group({running:false,failed:true})],{mode:'compact'},{},[],false).g,true);
});
test('initial tool name delta and later name repair update live activity',()=>{
 const agg=protocol.newAggregator();
 function push(seq,event){protocol.applyEvent(agg,{seq,sessionId:'s',event});}
 push(1,{type:'assistant/chunk',turn:1,chunkType:'tool-call-delta',tool:{id:'c',name:null,argumentsDelta:''}});
 assert.equal(agg.rows[0].tools.length,1);
 push(2,{type:'assistant/chunk',turn:1,chunkType:'tool-call-delta',tool:{id:'c',name:'bash',argumentsDelta:''}});
 assert.equal(agg.rows[0].tools[0].name,'bash');
 assert.equal(buildEntries(agg.rows,{running:true})[0].title,'正在执行命令');
 push(3,{type:'tool/result',turn:1,callId:'c',preview:'ok'});
 assert.equal(buildEntries(agg.rows,{running:true})[0].title,'正在整理工具结果');
 push(4,{type:'assistant/chunk',turn:1,chunkType:'text',text:'完成'});
 assert.equal(buildEntries(agg.rows,{running:true}).at(-1).title,'正在生成回复');
 push(5,{type:'turn/end',turn:1,reason:'completed'});
 assert.equal(buildEntries(agg.rows)[0].title,'已完成');
});
test('active work sits below narration and obeys completion collapse settings',()=>{
 const rows=[{kind:'user',key:'u',text:'执行任务'},
   {kind:'assistant',key:'a',turn:1,text:'先检查文件',reasoning:'检查中',tools:[],streaming:true}];
 const live=buildEntries(rows,{running:true});
 assert.deepEqual(live.map(r=>r.kind),['user','assistant','processGroup']);
 const folds=policy.apply(live,{mode:'detailed',timing:'completion'},{},[],true);
 assert.equal(folds[live.at(-1).key],true);
 rows[1].streaming=false;rows[1].turnClosed=true;rows[1].turnEndReason='completed';
 const done=buildEntries(rows);
 assert.deepEqual(done.map(r=>r.kind),['user','processGroup','assistant']);
 assert.equal(done[1].key,live.at(-1).key);
 assert.equal(policy.apply(done,{mode:'detailed',timing:'completion'},folds,live,false)[done[1].key],false);
 assert.equal(policy.apply(done,{mode:'detailed',timing:'next-input'},folds,live,false)[done[1].key],true);
 assert.equal(policy.apply(done,{mode:'verbose',timing:'completion'},folds,live,false)[done[1].key],true);
});
test('settings persistence validates modes and leaves failed writes visible to caller',()=>{
 let stored;global.wx={getStorageSync:()=>stored,setStorageSync:(key,v)=>{assert.equal(key,policy.KEY);stored=v;}};
 try{assert.deepEqual(policy.read(),{mode:'detailed',timing:'completion'});policy.save({mode:'verbose',timing:'next-input'});assert.equal(policy.read().mode,'verbose');assert.equal(policy.view(policy.read()).workStepTimingLabel,'下次有新消息时');wx.setStorageSync=()=>{throw Error('full')};assert.throws(()=>policy.save({mode:'compact'}));}finally{delete global.wx;}
});
