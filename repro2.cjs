const fs=require('fs'),path=require('path'),vm=require('node:vm');
const file=path.resolve('miniprogram/utils/store.js');
const mod={exports:{}},timers=new Map(),storage=new Map();let serial=0;
class Client{constructor(cb){this.callbacks=cb;this.connectGeneration=1;return new Proxy(this,{get(t,k){if(k in t)return t[k];return ()=>true;}});}requestHistory(){return true;}}
vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:mod,Date,console,wx:{getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k)},setTimeout(fn,d){timers.set(++serial,{fn,d});return serial;},clearTimeout:id=>timers.delete(id),setInterval(){return 0;},clearInterval(){},require:n=>n==='./gateway'?{GatewayClient:Client}:require(path.resolve(path.dirname(file),n))});
const store=mod.exports;
store.state.connection='connected';
const frame=v=>store.client.callbacks.onFrame({sessionId:store.sessionState.sessionId,...v});
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
function buildHost(n){
  const host=[];
  for(let i=1;i<=n;i++){
    if(i%7===0) host.push({type:'user/message',seq:i,time:i,data:{content:[{type:'text',text:'question '+i}],source:{kind:'user'}}});
    else if(i%7===3) host.push({type:'assistant/message',seq:i,time:i,turn:Math.floor(i/7),step:i,data:{message:{content:[{type:'text',text:'answer '+i}]},usage:{}}});
    else if(i%7===5) host.push({type:'tool/call',seq:i,time:i,turn:Math.floor(i/7),step:i,data:{callId:'c'+i,name:'bash',arguments:{command:'echo '+i}}});
    else if(i%7===6) host.push({type:'tool/result',seq:i,time:i,turn:Math.floor(i/7),step:i,data:{callId:'c'+(i-1),message:{content:[{type:'text',text:'ok '+i}]}}});
    else host.push({type:'assistant/chunk',seq:i,time:i,data:{chunk:{type:'text',text:'stream '+i}}});
  }
  return host;
}
const ACTIVE={attemptId:'att-1',turn:43,step:298,startedAfterSeq:297,nextIndex:3,
  stream:[{type:'chunk',chunk:{type:'text',text:'正在执行的这一'}},{type:'chunk',chunk:{type:'text',text:'步回复…'}}]};
const host=buildHost(300), CURSOR=299;

function scenario(name,fn){
  const fresh={exports:{}};
  // fresh module instance per scenario
  const m2={exports:{}};
  const t2=new Map(),s2=new Map();let ser=0;
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:m2,Date,console,wx:{getStorageSync:k=>s2.get(k),setStorageSync:(k,v)=>s2.set(k,v),removeStorageSync:k=>s2.delete(k)},setTimeout(fn2,d){t2.set(++ser,{fn:fn2,d});return ser;},clearTimeout:id=>t2.delete(id),setInterval(){return 0;},clearInterval(){},require:n=>n==='./gateway'?{GatewayClient:Client}:require(path.resolve(path.dirname(file),n))});
  const st=m2.exports; st.state.connection='connected';
  const fr=v=>st.client.callbacks.onFrame({sessionId:st.sessionState.sessionId,...v});
  console.log('--- '+name+' ---');
  fn(st,fr);
  console.log('   rows='+st.sessionState.rows.length,'state='+st.sessionState.historyState,'running='+st.sessionState.running,
    st.sessionState.rows.length===0?'  <<< EMPTY BODY':'(ok)');
}

const snap=()=>historyPage(host,{sessionId:'s',maxBytes:OPENING,hasMore:true,view:'conversation'});
const hist=()=>historyPage(host,{sessionId:'s',maxBytes:2*1024*1024,hasMore:true,view:'conversation'});

scenario('A: snapshot FIRST, then history',(st,fr)=>{
  st.openSession('s','R');
  const s=snap();
  fr({kind:'session-snapshot',sessionId:'s',replace:true,assistantStream:{revision:1,activeAttempt:ACTIVE},
    events:s.events,hasMore:s.hasMore,nextBeforeSeq:s.nextBeforeSeq,cursor:CURSOR,historyFormatVersion:4,projections:{values:{},asOfSeq:CURSOR}});
  fr(hist());
});
scenario('B: history FIRST, then snapshot',(st,fr)=>{
  st.openSession('s','R');
  fr(hist());
  const s=snap();
  fr({kind:'session-snapshot',sessionId:'s',replace:true,assistantStream:{revision:1,activeAttempt:ACTIVE},
    events:s.events,hasMore:s.hasMore,nextBeforeSeq:s.nextBeforeSeq,cursor:CURSOR,historyFormatVersion:4,projections:{values:{},asOfSeq:CURSOR}});
});
scenario('C: snapshot with EMPTY events (host has no records yet)',(st,fr)=>{
  st.openSession('s','R');
  fr({kind:'session-snapshot',sessionId:'s',replace:true,assistantStream:{revision:1,activeAttempt:ACTIVE},
    events:[],hasMore:false,cursor:-1,historyFormatVersion:4,projections:{values:{},asOfSeq:-1}});
  fr(hist());
});
scenario('D: snapshot with NO assistantStream, empty events',(st,fr)=>{
  st.openSession('s','R');
  fr({kind:'session-snapshot',sessionId:'s',replace:true,events:[],hasMore:false,cursor:-1,historyFormatVersion:4,projections:{values:{},asOfSeq:-1}});
  fr(hist());
});
