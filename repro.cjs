const fs=require('fs'),path=require('path'),vm=require('node:vm');
const file=path.resolve('miniprogram/utils/store.js');
const mod={exports:{}},timers=new Map(),storage=new Map();let serial=0;
class Client{constructor(cb){this.callbacks=cb;this.connectGeneration=1;return new Proxy(this,{get(t,k){if(k in t)return t[k];return ()=>true;}});}requestHistory(){return true;}}
vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:mod,Date,console,wx:{getStorageSync:()=>undefined,setStorageSync(){},removeStorageSync(){}},setTimeout(fn,d){timers.set(++serial,{fn,d});return serial;},clearTimeout:id=>timers.delete(id),setInterval(){return 0;},clearInterval(){},require:n=>n==='./gateway'?{GatewayClient:Client}:require(path.resolve(path.dirname(file),n))});
const store=mod.exports;
store.state.connection='connected';
const frame=v=>store.client.callbacks.onFrame({sessionId:store.sessionState.sessionId,...v});

// ---- gateway-side helpers (mirrored from dsh-plugin-weapp-gateway/lib/index.mjs) ----
const OPENING=256*1024;
function trimConversationEvent(e){
  switch(e.type){
    case 'assistant/chunk': case 'request/header': case 'request/context': case 'system/message': return null;
    case 'assistant/message': case 'assistant/attempt': { const {stream,...data}=e.data||{}; return {...e,data}; }
    default: return e;
  }
}
function cap(events,maxBytes){
  const processed=events.map(trimConversationEvent).filter(Boolean);
  let total=0,keptStart=processed.length;
  for(let i=processed.length-1;i>=0;i--){
    const size=Buffer.byteLength(JSON.stringify(processed[i]),'utf8');
    if(keptStart===processed.length){total=size;keptStart=i;continue;}
    if(total+size>maxBytes)break; total+=size;keptStart=i;
  }
  return {events:processed.slice(keptStart),dropped:keptStart};
}
function historyPage(events,msg){
  const c=cap(events,msg.maxBytes||4*1024*1024);
  const hasMore=msg.hasMore===true||c.dropped>0;
  const oldest=c.events[0]?c.events[0].seq:events[0]&&events[0].seq;
  return {kind:'history',sessionId:msg.sessionId,events:c.events,hasMore,
    ...(hasMore&&oldest!==undefined?{nextBeforeSeq:oldest}:{})};
}

// ---- a realistic RUNNING session on the host ----
// 300 durable events: user msgs, assistant msgs, tool calls/results, and an
// in-flight assistant attempt (the currently executing step)
const host=[];
for(let i=1;i<=300;i++){
  if(i%7===0) host.push({type:'user/message',seq:i,time:i,data:{content:[{type:'text',text:'question '+i}],source:{kind:'user'}}});
  else if(i%7===3) host.push({type:'assistant/message',seq:i,time:i,turn:Math.floor(i/7),step:i,data:{message:{content:[{type:'text',text:'answer '+i}]},usage:{}}});
  else if(i%7===5) host.push({type:'tool/call',seq:i,time:i,turn:Math.floor(i/7),step:i,data:{callId:'c'+i,name:'bash',arguments:{command:'echo '+i}}});
  else if(i%7===6) host.push({type:'tool/result',seq:i,time:i,turn:Math.floor(i/7),step:i,data:{callId:'c'+(i-1),message:{content:[{type:'text',text:'ok '+i}]}}});
  else host.push({type:'assistant/chunk',seq:i,time:i,data:{chunk:{type:'text',text:'stream '+i}}});
}
const CURSOR=host[host.length-1].seq;
const ACTIVE={attemptId:'att-1',turn:43,step:298,startedAfterSeq:297,nextIndex:3,
  stream:[{type:'chunk',chunk:{type:'text',text:'正在执行的这一'}},
          {type:'chunk',chunk:{type:'text',text:'步回复…'}}]};

console.log('=== open a RUNNING session (no local cache) ===');
store.openSession('s','Running');
console.log('after openSession: rows='+store.sessionState.rows.length,'historyState='+store.sessionState.historyState,'running='+store.sessionState.running);

// gateway: history query reply (this is what requestHistory triggers)
frame(historyPage(host,{sessionId:'s',maxBytes:2*1024*1024,hasMore:true,view:'conversation'}));
console.log('after history    : rows='+store.sessionState.rows.length,'historyState='+store.sessionState.historyState);

// gateway: follower snapshot (replace:true, capped to 256KB opening budget)
const snap=historyPage(host,{sessionId:'s',maxBytes:OPENING,hasMore:true,view:'conversation'});
frame({kind:'session-snapshot',sessionId:'s',replace:true,assistantStream:{revision:1,activeAttempt:ACTIVE},
  events:snap.events,hasMore:snap.hasMore,nextBeforeSeq:snap.nextBeforeSeq,cursor:CURSOR,
  historyFormatVersion:4,projections:{values:{},asOfSeq:CURSOR}});
console.log('after snapshot   : rows='+store.sessionState.rows.length,'historyState='+store.sessionState.historyState,'running='+store.sessionState.running);
console.log('');
console.log('rows visible to the page:',store.sessionState.rows.length);
console.log('kinds:',JSON.stringify(store.sessionState.rows.reduce((m,r)=>{m[r.kind]=(m[r.kind]||0)+1;return m;},{})));
console.log('last 3 texts:',JSON.stringify(store.sessionState.rows.slice(-3).map(r=>({k:r.kind,t:(r.text||'').slice(0,20)}))));
console.log('');
console.log(store.sessionState.rows.length===0
  ? '>>> BUG REPRODUCED: conversation body is EMPTY, only the running whale strip shows'
  : '>>> rows present');
